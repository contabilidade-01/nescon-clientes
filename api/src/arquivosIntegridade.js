/**
 * Integridade dos arquivos: a linha do banco aponta para um PDF que existe?
 *
 * O volume `uploads` é um volume Docker sem backup. Perdê-lo deixaria o banco cheio de
 * entregas apontando para arquivo inexistente — e o cliente clicaria em "Abrir" para
 * receber um erro.
 *
 * A saída aqui não é fazer backup dos PDFs: é reconhecer que **eles são recuperáveis**.
 * Quase tudo veio do G-Click e pode ser baixado de novo. O que NÃO se recupera é o banco
 * — decisões do escritório, marcações de obrigação, consentimentos, histórico de envio.
 * Esse sim precisa de cópia.
 *
 * O reparo é indireto de propósito: em vez de reimplementar o download, apaga-se a marca
 * de versão (`gclick_versao_em`) das linhas órfãs. A sincronização normal deixa de ver
 * aquilo como "já tenho" e rebaixa o arquivo pelo caminho de sempre — o mesmo código
 * testado, sem uma segunda via para manter.
 */
const fs = require("fs");
const { resolveUploadPath } = require("./uploads");

/**
 * Confere todas as entregas contra o disco.
 *
 * Lê em blocos porque a carteira inteira pode ter milhares de linhas e a resposta
 * precisa caber na memória sem susto.
 */
async function conferir(db, { limiteExemplos = 20 } = {}) {
  const { rows } = await db.query(
    `SELECT d.id, d.company_id, c.name AS empresa, d.title, d.competencia,
            d.file_path, d.source, d.historico
       FROM deliverables d
       JOIN companies c ON c.id = d.company_id
      WHERE d.file_path IS NOT NULL`
  );

  const faltando = [];
  for (const r of rows) {
    const full = resolveUploadPath(r.file_path);
    if (!full || !fs.existsSync(full)) faltando.push(r);
  }

  const recuperaveis = faltando.filter((f) => f.source === "gclick");
  const perdidos = faltando.filter((f) => f.source !== "gclick");

  return {
    total: rows.length,
    ok: rows.length - faltando.length,
    faltando: faltando.length,
    // Vieram do G-Click: dá para baixar de novo.
    recuperaveis: recuperaveis.length,
    // Upload manual do escritório: se o arquivo sumiu, sumiu. Só reenviando.
    perdidos: perdidos.length,
    exemplos: faltando.slice(0, limiteExemplos).map((f) => ({
      empresa: f.empresa,
      title: f.title,
      competencia: f.competencia,
      source: f.source,
    })),
  };
}

/**
 * Marca as entregas órfãs do G-Click para serem baixadas de novo.
 *
 * Não baixa nada aqui: só apaga a marca de versão. A próxima sincronização daquela
 * competência trata a linha como desatualizada e refaz o download pelo caminho normal.
 */
async function marcarParaRebaixar(db) {
  const { rows } = await db.query(
    `SELECT id, file_path FROM deliverables
      WHERE source = 'gclick' AND file_path IS NOT NULL AND gclick_versao_em IS NOT NULL`
  );

  const orfas = rows
    .filter((r) => {
      const full = resolveUploadPath(r.file_path);
      return !full || !fs.existsSync(full);
    })
    .map((r) => r.id);

  if (!orfas.length) return { marcadas: 0 };

  await db.query(`UPDATE deliverables SET gclick_versao_em = NULL WHERE id = ANY($1::uuid[])`, [
    orfas,
  ]);
  return { marcadas: orfas.length };
}

module.exports = { conferir, marcarParaRebaixar };
