/**
 * Envio de mensagem de TESTE, manual e isolado.
 *
 * Serve para o escritório depurar o recebimento no WhatsApp sem esperar um vencimento
 * real cair no dia. Manda UMA mensagem real ao número RESOLVIDO da empresa (o mesmo
 * COALESCE(manual, G-Click) do envio de verdade), mas:
 *   - NÃO grava em alert_sends → não consome a trava do dia, então o envio automático
 *     continua intacto ("sem prejuízo dos automáticos");
 *   - usa os MESMOS modelos de texto do envio real (montarMensagemAlerta / docNotify),
 *     para o que você testa ser o que o cliente receberia;
 *   - marca "MENSAGEM DE TESTE" no topo, para nunca ser confundida com cobrança real.
 *
 * Três casos, que são os que dá para reproduzir na hora:
 *   - 'documentos'     → "Há documentos no portal"
 *   - 'boleto_em_dia'  → boleto a vencer (lembrete)
 *   - 'boleto_vencido' → boleto vencido (cobrança)
 */
const { enviarTexto } = require("./uazapi");
const numeroWpp = require("./whatsappNumero");
const { whatsappSql, JOIN_ESPELHO } = require("./alertas");
const { montarMensagemAlerta } = require("./alertasRegras");
const { montarTexto: montarTextoDocs } = require("./docNotify");
const { hojeSP, somarDias } = require("./diasBancarios");

const TIPOS = new Set(["documentos", "boleto_em_dia", "boleto_vencido"]);

function portalUrl(caminho = "/") {
  const base = (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
  return base ? `${base}${caminho}` : "";
}

/** Monta o corpo do teste com o modelo REAL de cada caso. */
function montarCorpoTeste(tipo, empresaNome) {
  const hoje = hojeSP();
  if (tipo === "documentos") {
    return montarTextoDocs(empresaNome, [
      { title: "Documento de teste", competencia: hoje.slice(0, 7) },
    ]);
  }
  const vencido = tipo === "boleto_vencido";
  const item = {
    isBoleto: true,
    nome: "Boleto de teste",
    valorCentavos: 12345,
    vencimento: vencido ? somarDias(hoje, -3) : somarDias(hoje, 1),
    diasEmAtraso: vencido ? 3 : null,
  };
  return montarMensagemAlerta({
    empresaNome,
    hoje,
    itens: [item],
    portalUrl: portalUrl("/boletos"),
  });
}

/**
 * Envia o teste. Devolve `{ ok, numero, texto, erro }` — nunca lança, para a tela
 * mostrar o motivo em vez de estourar.
 */
async function enviarAlertaTeste(db, { companyId, tipo }) {
  if (!TIPOS.has(tipo)) return { ok: false, erro: "Tipo de teste inválido." };

  const { rows } = await db.query(
    `SELECT c.name, ${whatsappSql("c")} AS whatsapp
       FROM companies c ${JOIN_ESPELHO}
      WHERE c.id = $1`,
    [companyId]
  );
  const empresa = rows[0];
  if (!empresa) return { ok: false, erro: "Empresa não encontrada." };

  const v = numeroWpp.validar(empresa.whatsapp);
  if (!v.ok) {
    return { ok: false, erro: v.motivo || "WhatsApp inválido.", numero: empresa.whatsapp || null };
  }

  const corpo = montarCorpoTeste(tipo, empresa.name);
  const texto = `🧪 *MENSAGEM DE TESTE* (envio manual, não é cobrança)\n\n${corpo}`;

  try {
    await enviarTexto({ numero: v.numero, texto });
    return { ok: true, numero: v.numero, texto };
  } catch (err) {
    return { ok: false, erro: err.message, numero: v.numero };
  }
}

module.exports = { enviarAlertaTeste, TIPOS };
