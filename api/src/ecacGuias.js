/**
 * Gerar e baixar guia do e-CAC — o núcleo usado pelo portal logado (`routes/ecac.js`)
 * e pelo link sem senha (`routes/acesso.js`). Uma regra só, dois caminhos de entrada.
 *
 * A empresa vem SEMPRE de quem chama (token do login ou do link), nunca do pedido.
 */
const db = require("./db");
const ecac = require("./ecacClient");
const { ultimaPendencia } = require("./ecacPendencias");
const cobranca = require("./ecacCobranca");
const regras = require("./ecacRegras");

/**
 * Devolve { status, body }. `escritorio` libera tipos de parcela (só o escritório emite).
 * `origem`: portal | escritorio | link.
 */
async function gerarGuia({ empresa, quem, corpo, escritorio = false, origem = "portal" }) {
  const cnpj = regras.cnpjChave(empresa.cnpj);
  if (!cnpj) return { status: 400, body: { error: "Empresa sem CNPJ." } };

  const tipo = String(corpo?.tipo || "SN").toUpperCase();
  const ehParcela = ecac.TIPOS_PARCELA.includes(tipo);
  if (!["SN", "MEI", "DCTFWEB"].includes(tipo) && !(ehParcela && escritorio)) {
    return { status: 400, body: { error: "Tipo de guia não disponível pelo portal. Fale com o escritório." } };
  }
  const pa = regras.soDigitos(corpo?.periodo_apuracao);
  if (pa.length !== 6) return { status: 400, body: { error: "Competência inválida (AAAAMM)." } };
  const dataPg = ehParcela ? "" : String(corpo?.data_pagamento || "").slice(0, 10);
  if (dataPg && !/^\d{4}-\d{2}-\d{2}$/.test(dataPg)) return { status: 400, body: { error: "Data de pagamento inválida." } };

  // A competência pedida tem de estar no espelho da PRÓPRIA empresa: o cliente só gera
  // guia do que a Receita mostra para ele. (Parcela: conferida lá contra a consulta.)
  if (!ehParcela) {
    const tipoDebito = tipo === "DCTFWEB" ? "INSS" : tipo;
    const p = await ultimaPendencia(db, empresa.id);
    const conhecida = (p?.debitos || []).some(
      (d) => regras.vaiParaCliente(d) && d.periodo_aaaamm === pa && String(d.tipo).toUpperCase() === tipoDebito
    );
    if (!conhecida) {
      return { status: 400, body: { error: "Esta competência não consta no relatório da Receita. Fale com o escritório." } };
    }
  }

  try {
    const r = await ecac.emitirGuia({
      cnpj,
      tipo,
      periodoApuracao: pa,
      dataConsolidacao: dataPg ? dataPg.replace(/-/g, "") : null,
      origem,
      solicitadoPor: quem,
    });
    const guia = await cobranca.registrarGuiaGerada(db, { companyId: empresa.id, emissao: r.emissao, reuso: r.reuso, solicitadoPor: quem });
    return { status: 200, body: { ok: true, reuso: Boolean(r.reuso), guia } };
  } catch (err) {
    if (err instanceof ecac.EcacRecusou) return { status: err.status === 429 ? 429 : 409, body: { error: err.message } };
    if (err instanceof ecac.EcacNaoConfigurado) return { status: 503, body: { error: "Integração com o e-CAC não está configurada." } };
    console.error("[ecac] emitir guia:", err.message);
    return { status: 502, body: { error: "Não foi possível gerar a guia agora. Tente em alguns minutos ou fale com o escritório." } };
  }
}

/** Envia o PDF de uma guia gerada da empresa (ou o erro). */
async function enviarPdf(res, empresa, idGuia) {
  const id = Number(idGuia);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "id inválido" });
  const { rows } = await db.query(`SELECT * FROM ecac_guias WHERE id = $1 AND company_id = $2`, [id, empresa.id]);
  if (!rows.length) return res.status(404).json({ error: "Guia não encontrada" });
  const g = rows[0];
  try {
    const pdf = await ecac.pdfGuia(g.emissao_id, empresa.cnpj);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${g.tipo}_${g.periodo_apuracao}.pdf"`,
      "Cache-Control": "no-store, private",
    });
    return res.end(pdf);
  } catch (err) {
    if (err instanceof ecac.EcacRecusou) return res.status(410).json({ error: err.message });
    console.error("[ecac] pdf:", err.message);
    return res.status(502).json({ error: "PDF indisponível no momento." });
  }
}

module.exports = { gerarGuia, enviarPdf };
