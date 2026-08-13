/**
 * Aviso de "documento novo" pelo WhatsApp — mandado pelo PRÓPRIO PORTAL.
 *
 * Antes, esse aviso dependia do sistema de guias (GCLICK) chamar POST /api/fiscal/release
 * e, do lado de lá, decidir mandar a mensagem (o portal só devolvia um campo
 * `avisar_cliente` de sinalização). Com o GCLICK pausado, ninguém nunca chamava essa
 * ponta — o cliente parava de ser avisado de documento novo e nada no sistema acusava
 * isso como erro, porque tecnicamente não era: o contrato dependia inteiro do outro lado.
 *
 * Agora que o portal já busca e libera o documento sozinho (`gclick/sync.js`), o aviso
 * sai daqui também — sem depender de mais nenhum sistema externo estar de pé.
 *
 * Reusa o MESMO limitador de envio de `alertasEnvio.js` (teto/hora, retry, trava contra
 * mandar pro próprio número da instância): é a mesma instância de WhatsApp, então o teto
 * tem que ser um só — dois limitadores independentes somados poderiam estourar o real.
 */
const uazapi = require("./uazapi");
const numeroWpp = require("./whatsappNumero");
const { whatsappSql, JOIN_ESPELHO } = require("./alertas");
const { enviarComRetry, sobOTeto, marcarEnviado } = require("./alertasEnvio");

function portalUrl(caminho = "/") {
  const base = (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
  return base ? `${base}${caminho}` : null;
}

function montarTexto(nomeEmpresa, documentos) {
  const plural = documentos.length > 1;
  const linhas = documentos
    .slice(0, 8)
    .map((d) => `• ${d.title}${d.competencia ? ` (${d.competencia})` : ""}`);
  const resto = documentos.length > 8 ? [`… e mais ${documentos.length - 8} documento(s).`] : [];
  const link = portalUrl("/entregas");

  return [
    `Olá! Chegou${plural ? "ram" : ""} novo${plural ? "s" : ""} documento${plural ? "s" : ""} no portal, ${nomeEmpresa}:`,
    "",
    ...linhas,
    ...resto,
    "",
    link ? `Acesse: ${link}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n")
    .trim();
}

/**
 * Avisa uma empresa sobre documentos recém-liberados. `documentos`: [{ title, competencia }].
 * Nunca lança — falha de envio vira `{ enviado: false, motivo }`, quem chama decide se loga.
 */
async function notificarDocumentosNovos(db, companyId, documentos) {
  if (!documentos || !documentos.length) return { enviado: false, motivo: "sem documentos" };
  if (!uazapi.configurado()) return { enviado: false, motivo: "uazapi não configurada" };

  try {
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.avisos_documentos_ativos, ${whatsappSql("c")} AS whatsapp
         FROM companies c ${JOIN_ESPELHO}
        WHERE c.id = $1 AND c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE`,
      [companyId]
    );
    if (!rows.length) return { enviado: false, motivo: "empresa não encontrada, arquivada ou excluída" };
    const empresa = rows[0];

    // Vontade do cliente, tomada no portal dele — ver preferencias.js.
    if (empresa.avisos_documentos_ativos === false) {
      return { enviado: false, motivo: "cliente desativou avisos de documento novo" };
    }

    const v = numeroWpp.validar(empresa.whatsapp);
    if (!v.ok) return { enviado: false, motivo: v.motivo };

    const meuNumero = await uazapi.owner();
    if (meuNumero && v.numero === meuNumero) {
      return { enviado: false, motivo: "é o próprio número da instância — o envio falharia em silêncio" };
    }

    if (!sobOTeto()) {
      return { enviado: false, motivo: "teto de envios/hora atingido — não repete sozinho, sem fila de retry" };
    }

    const texto = montarTexto(empresa.name, documentos);
    await enviarComRetry({ numero: v.numero, texto });
    marcarEnviado();
    return { enviado: true, numero: v.numero };
  } catch (err) {
    console.error("[docNotify]", companyId, err.message);
    return { enviado: false, motivo: err.message };
  }
}

module.exports = { notificarDocumentosNovos, montarTexto };
