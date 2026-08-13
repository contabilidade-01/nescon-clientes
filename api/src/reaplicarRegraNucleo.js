/**
 * Reaplica a REGRA de vencimento do núcleo (FGTS/DAS/INSS-DCTFWeb) sobre os documentos
 * já gravados — a correção "de base fidedigna" dos que entraram com data errada (lida do
 * PDF/G-Click) antes da regra passar a mandar. Ver vencimentoRegra.js.
 *
 * É cálculo puro (sem abrir PDF, sem IA), então roda rápido e pode ser síncrono no
 * request — diferente da varredura de IA (dueDateSugestoes.js), que vai para segundo
 * plano. Por isso o modo é "prévia → aplicar": `simular=true` só devolve o que mudaria,
 * `simular=false` grava. Nada é aplicado sozinho.
 *
 * `desde` (AAAA-MM) é obrigatório e limita por competência — FGTS antigo (pré-FGTS
 * Digital) vencia dia 7 LEGITIMAMENTE, e recalcular para dia 20 corromperia o histórico.
 */
const { vencimentoPorRegra, DOC_TYPE_PARA_OBRIGACAO } = require("./vencimentoRegra");

const TIPOS_NUCLEO = Object.keys(DOC_TYPE_PARA_OBRIGACAO);

async function reaplicarRegraNucleo(db, { desde, simular = true } = {}) {
  if (!desde || !/^\d{4}-\d{2}$/.test(desde)) {
    throw new Error("Parâmetro 'desde' deve estar no formato AAAA-MM");
  }

  const { rows } = await db.query(
    `SELECT d.id, d.doc_type, d.competencia, d.title,
            to_char(d.due_date, 'YYYY-MM-DD') AS due_date_atual,
            c.name AS empresa
       FROM deliverables d
       JOIN companies c ON c.id = d.company_id
      WHERE d.doc_type = ANY($1)
        AND d.competencia IS NOT NULL
        AND d.competencia >= $2
        AND d.cancelado IS NOT TRUE
      ORDER BY c.name, d.competencia, d.doc_type`,
    [TIPOS_NUCLEO, desde]
  );

  const mudancas = [];
  for (const r of rows) {
    const novo = vencimentoPorRegra(r.doc_type, r.competencia);
    if (novo && novo !== r.due_date_atual) {
      mudancas.push({
        id: r.id,
        empresa: r.empresa,
        doc_type: r.doc_type,
        competencia: r.competencia,
        title: r.title,
        de: r.due_date_atual,
        para: novo,
      });
    }
  }

  if (!simular) {
    for (const m of mudancas) {
      await db.query(`UPDATE deliverables SET due_date = $1 WHERE id = $2`, [m.para, m.id]);
    }
  }

  return {
    desde,
    analisados: rows.length,
    corrigidos: mudancas.length,
    aplicado: !simular,
    mudancas,
  };
}

module.exports = { reaplicarRegraNucleo, TIPOS_NUCLEO };
