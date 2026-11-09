/**
 * ENVIO do boleto ao cliente, alguns dias antes do vencimento (padrão: 5).
 *
 * É a primeira de duas mensagens do boleto, e não é um alerta:
 *   1. ENVIO (este módulo) — "segue o seu boleto", com o PDF, N dias antes do vencimento;
 *   2. LEMBRETE (alertas.js → itensBoletoDoDia) — aviso de vencimento, 1 dia antes.
 *
 * ## Datas
 * O dia do envio é o vencimento menos N. Se cair em sábado, domingo ou feriado nacional,
 * ANTECIPA para o dia bancário anterior (nunca empurra para depois — o cliente precisa de
 * tempo para pagar). Mesma regra do lembrete (diaDoLembreteBoleto).
 *
 * ## Desenho: por ESTADO, não por data exata
 * A condição é "hoje >= dia do envio, vencimento ainda não passou e ainda não foi enviado"
 * (carimbo `boleto_enviado_em`). Boleto emitido tarde (já dentro dos 5 dias) sai no primeiro
 * dia útil depois de emitido, e nenhuma rodada perdida (deploy, fim de semana) deixa o
 * cliente sem o boleto.
 *
 * ## Sem duplicar com o lembrete
 * Se hoje já é o dia do lembrete do boleto, o PDF vai junto com o lembrete (ver
 * boletoPdf.js); o envio é só carimbado, para o cliente não receber duas mensagens iguais
 * no mesmo dia.
 *
 * ## Travas
 * Dia bancário e janela diurna (no envio real), uazapi configurada, e os gates master da
 * empresa (alertas_ativos, aviso de vencimento do boleto ligado, arquivada, excluida). Um boleto por mensagem; PDF fresco da Cora
 * e, sem PDF, o texto com o link do portal.
 */
const db = require("./db");
const uazapi = require("./uazapi");
const numeroWpp = require("./whatsappNumero");
const { hojeSP, minutosSP, somarDias, ehDiaBancario, diaBancarioAnterior } = require("./diasBancarios");
const { dentroDaJanela } = require("./janelaEnvio");
const { lerConfig } = require("./alertasConfig");
const cora = require("./cora");
const { rodapeAutomatico, competenciaBR, valorBR } = require("./honorariosCobranca");

const PAUSA_ENTRE_ENVIOS_MS = Math.max(0, Number(process.env.BOLETO_ENVIO_PAUSA_MS) || 2000);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function portalBase() {
  return (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
}

/**
 * Dia em que o boleto deve ser ENVIADO: vencimento menos `diasAntes`, recuando para o dia
 * bancário anterior quando cai em fim de semana ou feriado. `diasAntes` 0/inválido = sem
 * envio (null). Função pura.
 */
function diaDoEnvioBoleto(dueDate, diasAntes) {
  const n = Number(diasAntes);
  if (!dueDate || !Number.isInteger(n) || n <= 0) return null;
  const dia = somarDias(dueDate, -n);
  return diaBancarioAnterior(dia) || dia;
}

/**
 * Decide se o boleto entra no envio de hoje. Função pura (testável sem banco).
 * Devolve "enviar", "carimbar" (já sai junto do lembrete hoje) ou null (ainda não é a hora
 * / já venceu / sem envio configurado / empresa com o aviso de vencimento desligado).
 */
function decidirEnvioBoleto({ dueDate, hoje, diasEnvio, diasLembrete, lembreteAtivo = true }) {
  // Segue a marcação da empresa ("Honorários — aviso de vencimento"): desligada, nada de
  // lembrete NEM de envio do boleto.
  if (!lembreteAtivo) return null;
  const diaEnvio = diaDoEnvioBoleto(dueDate, diasEnvio);
  if (!diaEnvio || !hoje || hoje < diaEnvio) return null;
  if (hoje > dueDate) return null;
  if (Number(diasLembrete) > 0) {
    const diaLembrete = somarDias(dueDate, -Number(diasLembrete));
    const diaLembreteUtil = diaBancarioAnterior(diaLembrete) || diaLembrete;
    if (hoje === diaLembreteUtil) return "carimbar";
  }
  return "enviar";
}

/** Texto do envio do boleto. Função pura: recebe estado, devolve texto. */
function montarMensagemBoleto({ empresa, competencia, valor, venc, isHonorario, portal, contato } = {}) {
  const comp = competenciaBR(competencia);
  const rotulo = isHonorario ? `Honorários${comp ? ` ${comp}` : ""}` : "Boleto";
  return [
    `Olá, *${empresa}*!`,
    "",
    `Segue o seu boleto — ${rotulo}${valor ? ` — *${valor}*` : ""} — com vencimento em *${venc}*.`,
    portal ? `📎 Ele também fica sempre no portal: ${portal}/boletos` : null,
    "",
    "_Nescon Contabilidade_",
    rodapeAutomatico(contato),
  ].filter((l) => l !== null).join("\n");
}

/**
 * Envia os boletos que já estão na hora. `simular: true` monta tudo e não envia nem grava.
 */
async function enviarBoletos({ simular = false, agora = new Date(), companyIds = null } = {}) {
  const hoje = hojeSP(agora);
  const vazio = (motivo) => ({ enviados: 0, pulados: 0, erros: [], resultados: [], motivo });

  const cfg = await lerConfig(db);
  const diasEnvio = cfg.boleto_envio_dias_antes;
  if (!diasEnvio) return vazio("envio do boleto desligado (0 dias)");
  if (!ehDiaBancario(hoje)) return vazio("fim de semana ou feriado");
  if (!simular && !dentroDaJanela(minutosSP(agora))) return vazio("fora da janela diurna");
  if (!simular && !uazapi.configurado()) return vazio("uazapi não configurada");

  const params = [hoje, somarDias(hoje, 31)];
  let filtroEmpresas = "";
  if (Array.isArray(companyIds) && companyIds.length) {
    params.push(companyIds);
    filtroEmpresas = ` AND c.id = ANY($${params.length}::uuid[])`;
  }

  const { rows } = await db.query(
    `SELECT d.id, d.competencia, d.valor_centavos, d.is_honorario, d.external_ref, d.pdf_url,
            to_char(d.due_date, 'YYYY-MM-DD') AS due_date,
            c.id AS company_id, c.name AS empresa_nome, c.boleto_lembrete_ativo,
            ${numeroWpp.celularSql()} AS whatsapp
       FROM deliverables d
       JOIN companies c ON c.id = d.company_id
       LEFT JOIN gclick_clients g ON g.company_id = c.id
      WHERE d.category = 'boleto'
        AND d.status IS DISTINCT FROM 'paid'
        AND d.cancelado IS NOT TRUE
        AND d.historico IS NOT TRUE
        AND d.released_at IS NOT NULL
        AND d.boleto_enviado_em IS NULL
        AND d.due_date >= $1::date AND d.due_date <= $2::date
        AND c.alertas_ativos IS TRUE
        AND c.boleto_lembrete_ativo IS NOT FALSE
        AND c.arquivada IS NOT TRUE
        AND c.excluida IS NOT TRUE${filtroEmpresas}
      ORDER BY c.name, d.due_date`,
    params
  );

  const meuNumero = simular ? null : await uazapi.owner().catch(() => null);
  const contato = numeroWpp.formatar(cfg.escritorio_whatsapp || "");
  const portal = portalBase();
  const resultados = [];
  const erros = [];
  let enviados = 0;
  let pulados = 0;

  const pendentes = [];
  for (const b of rows) {
    const decisao = decidirEnvioBoleto({
      dueDate: b.due_date,
      hoje,
      diasEnvio,
      diasLembrete: cfg.boleto_dias_antes,
      lembreteAtivo: b.boleto_lembrete_ativo !== false,
    });
    if (decisao === "carimbar") {
      if (!simular) await db.query("UPDATE deliverables SET boleto_enviado_em = now() WHERE id = $1", [b.id]);
      resultados.push({ empresa: b.empresa_nome, status: "junto-do-lembrete", vencimento: b.due_date });
      continue;
    }
    if (decisao === "enviar") pendentes.push(b);
  }

  for (let i = 0; i < pendentes.length; i += 1) {
    const b = pendentes[i];
    const v = numeroWpp.validar(b.whatsapp);
    if (!v.ok || (meuNumero && v.numero === meuNumero)) {
      pulados += 1;
      resultados.push({
        empresa: b.empresa_nome, status: "ignorado", vencimento: b.due_date,
        motivo: v.ok ? "é o próprio número da instância" : v.motivo,
      });
      continue;
    }

    const venc = b.due_date.split("-").reverse().join("/");
    const texto = montarMensagemBoleto({
      empresa: b.empresa_nome,
      competencia: b.competencia,
      valor: valorBR(b.valor_centavos),
      venc,
      isHonorario: b.is_honorario === true,
      portal,
      contato,
    });

    if (simular) {
      resultados.push({ empresa: b.empresa_nome, status: "sairia", numero: v.numero, vencimento: b.due_date, texto });
      continue;
    }

    try {
      // Consulta FRESCA na Cora, um boleto por vez, imediatamente antes de enviar: o sync
      // do dia pode ter horas. Pago ou cancelado não sai; sem resposta da Cora também não
      // (não dá para saber o estado) e fica para a próxima rodada, sem carimbo.
      const invoiceId = String(b.external_ref || "").replace(/^cora_/, "");
      let fileUrl = b.pdf_url || null;
      if (invoiceId) {
        const detalhe = await cora.getInvoiceDetail(invoiceId);
        if (!detalhe || !detalhe.status) {
          pulados += 1;
          resultados.push({ empresa: b.empresa_nome, status: "pulado", vencimento: b.due_date, motivo: "Cora não respondeu à consulta" });
          continue;
        }
        if (cora.mapCoraStatusToPortal(detalhe.status) === "paid") {
          await db.query("UPDATE deliverables SET status='paid', paid_at=COALESCE(paid_at, now()) WHERE id=$1", [b.id]);
          pulados += 1;
          resultados.push({ empresa: b.empresa_nome, status: "pulado", vencimento: b.due_date, motivo: "já pago na Cora" });
          continue;
        }
        if (cora.ehCancelado(detalhe.status)) {
          pulados += 1;
          resultados.push({ empresa: b.empresa_nome, status: "pulado", vencimento: b.due_date, motivo: "cancelado na Cora" });
          continue;
        }
        fileUrl = detalhe?.payment_options?.bank_slip?.url || fileUrl;
      }
      const docName = `Boleto_${String(b.empresa_nome).replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}_${venc.replace(/\//g, "-")}.pdf`;
      if (fileUrl) {
        await uazapi.enviarDocumento({ numero: v.numero, fileUrl, docName, caption: texto, delayMs: 2000 });
      } else {
        // Sem PDF: manda ao menos o texto, com o link do portal como plano B.
        await uazapi.enviarTexto({ numero: v.numero, texto, delayMs: 1200 });
      }
      await db.query("UPDATE deliverables SET boleto_enviado_em = now() WHERE id = $1", [b.id]);
      enviados += 1;
      resultados.push({ empresa: b.empresa_nome, status: "enviado", numero: v.numero, vencimento: b.due_date, comPdf: Boolean(fileUrl) });
    } catch (err) {
      // Sem carimbo: tenta de novo na próxima rodada (outro dia útil). Fim de semana não
      // chega aqui — a trava central da uazapi cuida disso.
      erros.push({ empresa: b.empresa_nome, motivo: err.message });
      resultados.push({ empresa: b.empresa_nome, status: "falhou", vencimento: b.due_date, motivo: err.message });
      if (err instanceof uazapi.UazapiTokenInvalido || err instanceof uazapi.UazapiFimDeSemana) {
        erros.push({ empresa: "GERAL", motivo: "envio de boletos interrompido: " + err.message });
        break;
      }
    }

    if (PAUSA_ENTRE_ENVIOS_MS && i < pendentes.length - 1) await espera(PAUSA_ENTRE_ENVIOS_MS);
  }

  if (!simular && (enviados || erros.length)) {
    console.log(`[boletoEnvio] ${hoje}: ${enviados} enviado(s), ${pulados} pulado(s), ${erros.length} erro(s).`);
  }
  return { enviados, pulados, erros, resultados };
}

module.exports = { enviarBoletos, diaDoEnvioBoleto, decidirEnvioBoleto, montarMensagemBoleto };
