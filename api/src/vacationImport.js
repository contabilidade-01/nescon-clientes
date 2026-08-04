/**
 * Gravação da Programação de Férias — **agnóstica de origem**.
 *
 * Hoje só o upload manual chama isto, porque o G-Click não expõe o relatório na API.
 * Quando existir a tarefa lá, o sync chama a mesma função com `source: 'gclick'`: a
 * decisão de guardar não muda por causa de quem trouxe o arquivo.
 */

/**
 * Confere se o PDF é da empresa certa antes de gravar.
 *
 * Trocar o arquivo de empresa é o erro mais fácil de cometer e o mais caro de perceber:
 * o cliente veria as férias dos funcionários de outro. Por isso o CNPJ do PDF é
 * comparado com o da empresa, e a divergência barra a importação em vez de avisar.
 */
function conferirEmpresa(cnpjPdf, cnpjEmpresa) {
  const a = String(cnpjPdf || "").replace(/\D/g, "");
  const b = String(cnpjEmpresa || "").replace(/\D/g, "");
  if (!a) return { ok: false, erro: "CNPJ não encontrado no PDF — confira se é uma Programação de Férias." };
  if (a !== b) {
    return {
      ok: false,
      erro: `Este PDF é do CNPJ ${a}, e a empresa selecionada é ${b}. Escolha a empresa certa.`,
    };
  }
  return { ok: true };
}

/**
 * Grava uma importação e seus períodos. Cada chamada cria uma **nova versão**; a mais
 * recente é a que vale nas telas, as anteriores ficam como histórico.
 *
 * Roda em transação: ou entra a importação inteira, ou não entra nada — uma
 * programação pela metade seria pior que nenhuma.
 */
async function salvarProgramacao(db, { companyId, parsed, arquivoNome, source = "manual", adminId = null }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const { rows: up } = await client.query(
      `INSERT INTO vacation_uploads
         (company_id, data_base, emissao, arquivo_nome, total_empregados, total_declarado, source, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        companyId,
        parsed.dataBase,
        parsed.emissao,
        arquivoNome || null,
        parsed.funcionarios.length,
        parsed.totalDeclarado,
        source,
        adminId,
      ]
    );
    const uploadId = up[0].id;

    let ordem = 0;
    for (const f of parsed.funcionarios) {
      for (const p of f.periodos) {
        ordem += 1;
        await client.query(
          `INSERT INTO vacation_periods
             (upload_id, company_id, codigo, nome, admissao, ferias_vencidas,
              inicio_aquisitivo, fim_aquisitivo, inicio_gozo, limite_gozo,
              dias_acumulados, dias_gozados, dias_direito, dias_afastamento, faltas, ordem)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            uploadId,
            companyId,
            f.codigo,
            f.nome,
            f.admissao,
            f.feriasVencidas || 0,
            p.inicioAquisitivo,
            p.fimAquisitivo,
            p.inicioGozo,
            p.limiteGozo,
            p.diasAcumulados || 0,
            p.diasGozados || 0,
            p.diasDireito || 0,
            p.diasAfastamento || 0,
            p.faltas || 0,
            ordem,
          ]
        );
      }
    }

    await client.query("COMMIT");
    return { uploadId, funcionarios: parsed.funcionarios.length, periodos: ordem };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Última programação da empresa, com os períodos. Null se nunca importaram. */
async function ultimaProgramacao(db, companyId) {
  const { rows: ups } = await db.query(
    `SELECT id, data_base, emissao, arquivo_nome, total_empregados, total_declarado, source, criado_em
       FROM vacation_uploads
      WHERE company_id = $1
      ORDER BY criado_em DESC
      LIMIT 1`,
    [companyId]
  );
  if (!ups.length) return null;
  const { rows: periodos } = await db.query(
    `SELECT * FROM vacation_periods WHERE upload_id = $1 ORDER BY ordem`,
    [ups[0].id]
  );
  return { upload: ups[0], periodos };
}

module.exports = { conferirEmpresa, salvarProgramacao, ultimaProgramacao };
