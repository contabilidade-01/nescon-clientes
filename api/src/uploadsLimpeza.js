/**
 * Varredura de arquivos órfãos no volume de uploads.
 *
 * Duas portas deixam arquivo sem dono:
 *  - o admin analisa um lote no upload de documentos e fecha a aba sem confirmar nem
 *    descartar (o arquivo já está no disco desde a análise);
 *  - a gravação de uma entrega falha entre escrever o PDF e inserir a linha.
 *
 * Sem varredura, o volume só cresce — e num VPS pequeno isso um dia derruba o portal.
 *
 * A regra é deliberadamente conservadora, porque apagar arquivo de cliente por engano
 * não tem volta:
 *  1. só remove o que **nenhuma** linha de `deliverables`/`certificates` referencia;
 *  2. só remove o que tem mais de `UPLOADS_TTL_HORAS` (padrão 48h) de idade — tempo de
 *     sobra para um lote ser confirmado, e margem para qualquer gravação em curso;
 *  3. em caso de qualquer dúvida na consulta, não apaga nada.
 */
const fs = require("fs");
const path = require("path");
const { UPLOAD_DIR } = require("./uploads");

const TTL_HORAS = Number(process.env.UPLOADS_TTL_HORAS || 48);
const INTERVALO_H = Number(process.env.UPLOADS_LIMPEZA_INTERVALO_H || 12);

/**
 * `simular = true` (padrão) só conta e lista. Apagar exige pedir explicitamente —
 * mesma postura do envio de alertas.
 */
async function varrer(db, { simular = true, ttlHoras = TTL_HORAS } = {}) {
  let arquivos;
  try {
    arquivos = fs.readdirSync(UPLOAD_DIR);
  } catch (err) {
    return { ok: false, erro: `Não consegui ler ${UPLOAD_DIR}: ${err.message}` };
  }

  // Tudo o que está em uso, numa consulta só. Se isto falhar, saímos sem apagar nada:
  // uma lista de "em uso" incompleta transformaria a limpeza em perda de documento.
  let emUso;
  try {
    const { rows } = await db.query(
      // As duas ÚNICAS tabelas que guardam caminho de arquivo. Conferido varrendo
      // `file_path` em todo o schema — se alguém acrescentar uma terceira e esquecer
      // desta linha, a varredura passa a apagar documento em uso.
      `SELECT file_path AS nome FROM deliverables WHERE file_path IS NOT NULL
       UNION
       SELECT file_path FROM medical_certificates WHERE file_path IS NOT NULL`
    );
    emUso = new Set(rows.map((r) => path.basename(String(r.nome))));
  } catch (err) {
    return { ok: false, erro: `Não consegui listar os arquivos em uso: ${err.message}` };
  }

  const limite = Date.now() - ttlHoras * 3600000;
  const orfaos = [];
  let bytes = 0;

  for (const nome of arquivos) {
    if (emUso.has(nome)) continue;
    const full = path.join(UPLOAD_DIR, nome);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (st.mtimeMs > limite) continue;
    orfaos.push({ nome, bytes: st.size, modificado_em: new Date(st.mtimeMs).toISOString() });
    bytes += st.size;
  }

  let removidos = 0;
  if (!simular) {
    for (const o of orfaos) {
      try {
        fs.unlinkSync(path.join(UPLOAD_DIR, o.nome));
        removidos += 1;
      } catch (err) {
        console.error("[uploads] falha ao remover órfão", o.nome, err.message);
      }
    }
  }

  return {
    ok: true,
    simulado: simular,
    total_no_disco: arquivos.length,
    em_uso: emUso.size,
    orfaos: orfaos.length,
    bytes,
    removidos,
    amostra: orfaos.slice(0, 20),
  };
}

/** Varredura periódica. Apaga de verdade — é o objetivo dela. */
function iniciarLimpezaUploads(db) {
  if (INTERVALO_H <= 0) {
    console.log("[uploads] limpeza automática desligada.");
    return;
  }
  const ciclo = async () => {
    try {
      const r = await varrer(db, { simular: false });
      if (!r.ok) return console.error("[uploads] limpeza:", r.erro);
      if (r.removidos) console.log(`[uploads] limpeza: ${r.removidos} órfão(s) removido(s).`);
    } catch (err) {
      console.error("[uploads] limpeza:", err.message);
    }
  };
  setInterval(ciclo, INTERVALO_H * 3600000);
  setTimeout(ciclo, 5 * 60000); // primeira passada alguns minutos após o arranque
  console.log(`[uploads] limpeza automática a cada ${INTERVALO_H}h (órfãos com +${TTL_HORAS}h).`);
}

module.exports = { varrer, iniciarLimpezaUploads, TTL_HORAS };
