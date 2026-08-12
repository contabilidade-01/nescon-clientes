/**
 * Rotina de varredura: encontra vencimento em `deliverables` sem due_date, a partir de
 * uma competência (nunca "tudo"), e enfileira sugestões em due_date_sugestoes para o
 * admin revisar. Nunca grava due_date sozinha.
 *
 * Ordem por documento: regex determinístico (pdfDueDate.js) primeiro; só cai para IA se
 * `ia_vencimento_habilitada` estiver ligada — toggle próprio, independente do de CNPJ,
 * porque um documento genérico tem mais chance de confundir a IA do que um DARF.
 * Nenhum resultado de nenhum dos dois: fica de fora da fila, não é erro.
 */
const fs = require("fs");
const { resolveUploadPath } = require("./uploads");
const { extrairVencimento, extrairVencimentoComIa } = require("./pdfDueDate");
const { getSetting } = require("./appSettings");

const LIMITE_PADRAO = 300;

/** 'AAAA-MM' -> primeiro dia do mês, para comparar com created_at de quem não tem competencia. */
function competenciaParaData(competencia) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(competencia || ""));
  if (!m) return null;
  return `${m[1]}-${m[2]}-01`;
}

async function varrerVencimentos(db, { desde, limite = LIMITE_PADRAO } = {}) {
  if (!desde || !/^\d{4}-\d{2}$/.test(desde)) {
    throw new Error("Parâmetro 'desde' deve estar no formato AAAA-MM");
  }
  const desdeData = competenciaParaData(desde);

  const { rows } = await db.query(
    `SELECT d.id, d.company_id, d.file_path, d.category, d.competencia
     FROM deliverables d
     WHERE d.due_date IS NULL
       AND d.cancelado IS NOT TRUE
       AND (
         (d.competencia IS NOT NULL AND d.competencia >= $1)
         OR (d.competencia IS NULL AND d.created_at >= $2::date)
       )
       AND NOT EXISTS (
         SELECT 1 FROM due_date_sugestoes s WHERE s.deliverable_id = d.id
       )
     ORDER BY d.created_at ASC
     LIMIT $3`,
    [desde, desdeData, limite]
  );

  const iaHabilitada = (await getSetting(db, "ia_vencimento_habilitada")) === "true";

  let sugestoesCriadas = 0;
  let semVencimento = 0;
  let erros = 0;

  for (const doc of rows) {
    try {
      const full = resolveUploadPath(doc.file_path);
      if (!full || !fs.existsSync(full)) {
        erros++;
        continue;
      }
      const buffer = fs.readFileSync(full);

      const det = await extrairVencimento(buffer);
      if (det) {
        await db.query(
          `INSERT INTO due_date_sugestoes (deliverable_id, data_sugerida, origem, confianca, motivo)
           VALUES ($1, $2, 'deterministico', 100, 'rótulo de vencimento reconhecido no PDF')`,
          [doc.id, det]
        );
        sugestoesCriadas++;
        continue;
      }

      if (iaHabilitada) {
        const viaIa = await extrairVencimentoComIa(buffer, db);
        if (viaIa && viaIa.data) {
          await db.query(
            `INSERT INTO due_date_sugestoes
               (deliverable_id, data_sugerida, origem, confianca, provider_ia, motivo)
             VALUES ($1, $2, 'ia', $3, $4, $5)`,
            [doc.id, viaIa.data, viaIa.confianca, viaIa.provider, viaIa.motivo]
          );
          sugestoesCriadas++;
          continue;
        }
      }

      semVencimento++;
    } catch (err) {
      console.error("[dueDateSugestoes] falha ao processar", doc.id, err.message);
      erros++;
    }
  }

  return {
    processados: rows.length,
    sugestoes_criadas: sugestoesCriadas,
    sem_vencimento: semVencimento,
    erros,
  };
}

module.exports = { varrerVencimentos };
