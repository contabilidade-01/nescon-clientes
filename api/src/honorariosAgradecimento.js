/**
 * Agradecimento pelo pagamento de HONORÁRIOS — o outro lado da régua de cobrança.
 *
 * Quando um honorário é reconhecido como pago, manda UMA mensagem calorosa que reforça a
 * parceria. Base: a gratidão do cliente ativa reciprocidade e sustenta a relação
 * (Palmatier et al., Journal of Marketing 2009; Bock et al., Psychology & Marketing 2021).
 *
 * ## Desenho: chaveado pelo ESTADO, não pelo evento
 *
 * O pagamento é reconhecido em vários pontos (sync da Cora, checagem fresca da cobrança,
 * marcação manual do admin) — todos gravam `status='paid' + paid_at`. Em vez de fiar o
 * agradecimento em cada um desses lugares, esta passada olha o ESTADO `paid` + o carimbo
 * `agradecimento_enviado_em` e envia uma vez por boleto. Um único ponto, robusto.
 *
 * ## Travas
 * - Janela diurna e uazapi configurada (no envio real). Qualquer dia da semana — agradecer
 *   no sábado é bem-vindo (≠ cobrança, que só cai em dia útil).
 * - Guarda anti-enxurrada: só agradece pagamentos recentes (AGRADECIMENTO_JANELA_DIAS) e
 *   a partir de AGRADECIMENTO_INICIO. Sem isso, a 1ª execução varreria meses de pagos.
 * - Gates por empresa (master): alertas_ativos, arquivada, excluida. NÃO usa
 *   honorario_cobranca_ativo — agradecer não deve depender de a cobrança estar ligada.
 * - 1 mensagem por empresa/dia: agrupa os boletos pagos pendentes de agradecimento.
 * - Dedup: `agradecimento_enviado_em` carimbado em todos os boletos do grupo no sucesso.
 */
const db = require("./db");
const uazapi = require("./uazapi");
const numeroWpp = require("./whatsappNumero");
const { hojeSP, minutosSP } = require("./diasBancarios");
const { dentroDaJanela } = require("./janelaEnvio");
const { lerConfig } = require("./alertasConfig");
const { rodapeAutomatico, competenciaBR, valorBR } = require("./honorariosCobranca");

function num(v, padrao) {
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
}

// Início da funcionalidade e janela de "pagamento recente". Mesma filosofia da cobrança:
// o padrão certo fica travado no código, ajustável por ambiente.
const INICIO_ISO = (process.env.AGRADECIMENTO_INICIO || "2026-09-01").trim();
const JANELA_DIAS = Math.max(1, num(process.env.AGRADECIMENTO_JANELA_DIAS, 7));
const PAUSA_ENTRE_ENVIOS_MS = Math.max(0, num(process.env.AGRADECIMENTO_PAUSA_MS, 2000));

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function portalBase() {
  return (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
}

/**
 * Corte de elegibilidade: o MAIOR entre AGRADECIMENTO_INICIO e (agora − janela). O piso
 * de início impede agradecer pagamentos anteriores à metodologia; a janela impede agradecer
 * um pago antigo que só agora foi sincronizado. Função pura (testável).
 */
function calcularCorte({ inicioISO = INICIO_ISO, janelaDias = JANELA_DIAS, agora = new Date() } = {}) {
  const inicio = new Date(`${inicioISO}T00:00:00-03:00`); // início do dia em SP
  const janela = new Date(agora.getTime() - janelaDias * 86400000);
  return inicio.getTime() > janela.getTime() ? inicio : janela;
}

/** "08/2026" a partir de "2026-08"; lista ordenada única -> "08/2026 e 09/2026". Pura. */
function competenciasTexto(competencias) {
  const brs = Array.from(new Set((competencias || []).filter(Boolean)))
    .sort()
    .map(competenciaBR)
    .filter(Boolean);
  if (!brs.length) return "";
  if (brs.length === 1) return brs[0];
  return `${brs.slice(0, -1).join(", ")} e ${brs[brs.length - 1]}`;
}

/**
 * Monta a mensagem de agradecimento. Função pura: recebe estado, devolve texto.
 * Tom caloroso, sem link de cobrança, sem pressão — é só reforço de parceria.
 */
function montarMensagemAgradecimento({ empresa, competencias = [], portal, contato } = {}) {
  const comps = competenciasTexto(competencias);
  const linhaComp = comps ? ` referente a *${comps}*` : "";
  const linhaPortal = portal ? `📄 Comprovantes e boletos ficam sempre no seu portal: ${portal}/boletos` : null;
  return [
    `Olá, *${empresa}*! 🤝`,
    "",
    `Recebemos o pagamento dos seus honorários${linhaComp}. Muito obrigado pela confiança e por manter nossa parceria em dia! 🙏`,
    "",
    "Seguimos cuidando de perto das suas obrigações — pode contar com a Nescon para o que precisar.",
    linhaPortal,
    "",
    "_Nescon Contabilidade_",
    rodapeAutomatico(contato),
  ].filter((l) => l !== null).join("\n");
}

/** Agrupa as linhas de boleto por empresa. Pura. */
function agruparPorEmpresa(rows) {
  const mapa = new Map();
  for (const r of rows || []) {
    const chave = r.company_id;
    if (!mapa.has(chave)) {
      mapa.set(chave, {
        company_id: r.company_id,
        empresa: r.empresa_nome,
        whatsapp: r.whatsapp,
        competencias: [],
        ids: [],
        valorCentavos: 0,
      });
    }
    const g = mapa.get(chave);
    g.ids.push(r.id);
    if (r.competencia) g.competencias.push(r.competencia);
    g.valorCentavos += Number(r.valor_centavos) || 0;
  }
  return [...mapa.values()];
}

/**
 * Envia os agradecimentos pendentes. `simular: true` monta tudo e não envia nem grava.
 */
async function agradecerPagamentos({ simular = false, agora = new Date(), companyIds = null } = {}) {
  const hoje = hojeSP(agora);
  if (hoje < INICIO_ISO) {
    return { enviados: 0, pulados: 0, erros: [], resultados: [], motivo: `funcionalidade inicia em ${INICIO_ISO}` };
  }
  if (!simular && !dentroDaJanela(minutosSP(agora))) {
    return { enviados: 0, pulados: 0, erros: [], resultados: [], motivo: "fora da janela diurna" };
  }
  if (!simular && !uazapi.configurado()) {
    return { enviados: 0, pulados: 0, erros: [], resultados: [], motivo: "uazapi não configurada" };
  }

  const corte = calcularCorte({ agora });
  const params = [corte.toISOString()];
  let filtroEmpresas = "";
  if (Array.isArray(companyIds) && companyIds.length) {
    params.push(companyIds);
    filtroEmpresas = ` AND c.id = ANY($${params.length}::uuid[])`;
  }

  const { rows } = await db.query(
    `SELECT d.id, d.competencia, d.valor_centavos,
            c.id AS company_id, c.name AS empresa_nome,
            ${numeroWpp.celularSql()} AS whatsapp
       FROM deliverables d
       JOIN companies c ON c.id = d.company_id
       LEFT JOIN gclick_clients g ON g.company_id = c.id
      WHERE d.category = 'boleto'
        AND d.is_honorario = true
        AND d.status = 'paid'
        AND d.cancelado IS NOT TRUE
        AND d.agradecimento_enviado_em IS NULL
        AND d.paid_at IS NOT NULL
        AND d.paid_at >= $1
        -- Gates master por empresa (agradecer NÃO depende de honorario_cobranca_ativo).
        AND c.alertas_ativos IS TRUE
        AND c.arquivada IS NOT TRUE
        AND c.excluida IS NOT TRUE${filtroEmpresas}
      ORDER BY c.name, d.competencia`,
    params
  );

  const grupos = agruparPorEmpresa(rows);
  const resultados = [];
  let enviados = 0;
  let pulados = 0;
  const erros = [];
  const portal = portalBase();
  const meuNumero = simular ? null : await uazapi.owner().catch(() => null);
  const cfg = await lerConfig(db).catch(() => ({}));
  const contato = numeroWpp.formatar(cfg.escritorio_whatsapp || "");

  for (const g of grupos) {
    const v = numeroWpp.validar(g.whatsapp);
    if (!v.ok || (meuNumero && v.numero === meuNumero)) {
      pulados += 1;
      const motivo = v.ok ? "é o próprio número da instância" : v.motivo;
      resultados.push({ empresa: g.empresa, company_id: g.company_id, status: "ignorado", motivo });
      continue;
    }

    const texto = montarMensagemAgradecimento({
      empresa: g.empresa,
      competencias: g.competencias,
      portal,
      contato,
    });

    if (simular) {
      resultados.push({ empresa: g.empresa, company_id: g.company_id, status: "sairia", numero: v.numero, texto });
      continue;
    }

    try {
      await uazapi.enviarTexto({ numero: v.numero, texto, delayMs: 1200 });
      await db.query(
        "UPDATE deliverables SET agradecimento_enviado_em = now() WHERE id = ANY($1::uuid[])",
        [g.ids]
      );
      enviados += 1;
      resultados.push({ empresa: g.empresa, company_id: g.company_id, status: "enviado", numero: v.numero, boletos: g.ids.length });
    } catch (err) {
      erros.push({ empresa: g.empresa, motivo: err.message });
      resultados.push({ empresa: g.empresa, company_id: g.company_id, status: "falhou", motivo: err.message });
      // Instância caída não melhora na próxima empresa: interrompe em vez de repetir o erro.
      if (err instanceof uazapi.UazapiTokenInvalido) {
        erros.push({ empresa: "GERAL", motivo: "WhatsApp desconectado — agradecimentos interrompidos" });
        break;
      }
    }

    if (PAUSA_ENTRE_ENVIOS_MS && grupos.indexOf(g) < grupos.length - 1) {
      await espera(PAUSA_ENTRE_ENVIOS_MS);
    }
  }

  if (!simular && (enviados || pulados)) {
    console.log(`[agradecimento] ${hoje}: ${enviados} enviado(s), ${pulados} pulado(s), ${erros.length} erro(s).`);
  }
  return { enviados, pulados, erros, resultados };
}

module.exports = {
  agradecerPagamentos,
  montarMensagemAgradecimento,
  competenciasTexto,
  calcularCorte,
  agruparPorEmpresa,
  cadencia: { INICIO_ISO, JANELA_DIAS },
};
