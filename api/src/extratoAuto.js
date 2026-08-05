/**
 * Leitura automática do Extrato Mensal, ao fim de cada sincronização com o G-Click.
 *
 * O extrato já vinha sozinho; o que faltava era ler. Regras, na ordem em que importam:
 *
 *  1. **Só processa quando o extrato muda.** A marca é o id da entrega, não a
 *     competência — assim uma retificação do mesmo mês também é relida, e reprocessar
 *     o mesmo arquivo a cada 6 horas não acontece.
 *  2. **Cadastra e atualiza** quem está no extrato (nome, CPF, código, salário).
 *  3. **Não inativa ninguém.** Quem sumiu do extrato vira um aviso para alguém
 *     confirmar. Ver o porquê em ensureExtratoAutoSchema.js.
 */
const fs = require("fs");
const { parseExtratoEmployees } = require("./extratoEmployees");
const { importEmployeesForCompany } = require("./employeeImport");
const { resolveUploadPath } = require("./uploads");

/**
 * Quem está cadastrado e ativo mas não apareceu no extrato — função pura, testada.
 * `ativos` e `cpfsNoExtrato` chegam com CPF só de dígitos.
 */
function calcularSaidas(ativos, cpfsNoExtrato) {
  const presentes = new Set(cpfsNoExtrato.map((c) => String(c || "").replace(/\D/g, "")));
  return ativos.filter((e) => !presentes.has(String(e.cpf || "").replace(/\D/g, "")));
}

let emExecucao = false;
let ultimoResultado = null;

function estaRodando() {
  return emExecucao;
}
function ultimaExecucao() {
  return ultimoResultado;
}

/** Última entrega de extrato de folha da empresa. */
async function ultimoExtrato(db, companyId) {
  const { rows } = await db.query(
    `SELECT id, competencia, file_path, file_name
       FROM deliverables
      WHERE company_id = $1 AND doc_type = 'EXTRATO_FOLHA'
      ORDER BY competencia DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [companyId]
  );
  return rows[0] || null;
}

async function processarEmpresa(db, empresa) {
  const extrato = await ultimoExtrato(db, empresa.id);
  if (!extrato) return { pulado: "sem extrato" };
  if (empresa.extrato_processado_id === extrato.id) return { pulado: "sem mudança" };

  const full = resolveUploadPath(extrato.file_path);
  if (!full || !fs.existsSync(full)) return { pulado: "arquivo ausente" };

  const { funcionarios, competencia } = await parseExtratoEmployees(fs.readFileSync(full));
  // Parse vazio: NÃO marca como processado — na próxima rodada tenta de novo, em vez
  // de dar o arquivo por lido e nunca mais voltar nele.
  if (!funcionarios.length) return { pulado: "parse vazio" };

  const comp = competencia || extrato.competencia || null;
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const r = await importEmployeesForCompany(
      client,
      empresa.id,
      empresa.cnpj,
      empresa.cnpj,
      funcionarios,
      { competencia: comp }
    );
    if (r.status !== 201) {
      await client.query("ROLLBACK");
      return { erro: r.body.error };
    }

    // Saídas viram AVISO, não inativação.
    //
    // Só entram no aviso os que TÊM CÓDIGO, ou seja, que já apareceram num extrato
    // antes. Isso resolve dois problemas de uma vez: a primeira execução não gera
    // enxurrada (quem falta ainda não tem código) e quem foi cadastrado por planilha,
    // e nunca esteve no extrato, não é cobrado como se tivesse sumido.
    const { rows: ativos } = await client.query(
      `SELECT id, name, cpf FROM employees
        WHERE company_id = $1 AND active IS TRUE AND codigo IS NOT NULL`,
      [empresa.id]
    );
    const saidas = calcularSaidas(ativos, funcionarios.map((f) => f.cpf));
    let avisos = 0;
    for (const s of saidas) {
      const ins = await client.query(
        `INSERT INTO employee_exit_alerts (company_id, employee_id, nome, cpf, competencia)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (employee_id) WHERE situacao = 'pendente' DO NOTHING`,
        [empresa.id, s.id, s.name, s.cpf, comp]
      );
      avisos += ins.rowCount;
    }

    await client.query(
      `UPDATE companies
          SET extrato_processado_id = $2,
              extrato_processado_competencia = $3,
              extrato_processado_em = now()
        WHERE id = $1`,
      [empresa.id, extrato.id, comp]
    );

    await client.query("COMMIT");
    return {
      competencia: comp,
      inseridos: r.body.inserted,
      atualizados: r.body.skipped,
      avisos,
      saidas: saidas.length,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return { erro: err.message };
  } finally {
    client.release();
  }
}

/** Varre todas as empresas. Uma falha isolada não interrompe as demais. */
async function processarExtratos(db) {
  if (emExecucao) return { ok: false, erro: "Leitura de extratos já em andamento" };
  emExecucao = true;
  const inicio = Date.now();
  const total = { empresas: 0, inseridos: 0, atualizados: 0, avisos: 0, erros: 0, pulados: 0 };

  try {
    const { rows: empresas } = await db.query(
      `SELECT id, name, cnpj, extrato_processado_id FROM companies ORDER BY name`
    );
    for (const empresa of empresas) {
      const r = await processarEmpresa(db, empresa);
      if (r.pulado) {
        total.pulados++;
        continue;
      }
      if (r.erro) {
        total.erros++;
        console.error("[extrato auto]", empresa.name, r.erro);
        continue;
      }
      total.empresas++;
      total.inseridos += r.inseridos;
      total.atualizados += r.atualizados;
      total.avisos += r.avisos;
    }

    ultimoResultado = {
      ...total,
      segundos: Math.round((Date.now() - inicio) / 1000),
      em: new Date().toISOString(),
    };
    console.log("[extrato auto] concluído:", JSON.stringify(ultimoResultado));
    return { ok: true, ...ultimoResultado };
  } catch (err) {
    console.error("[extrato auto] falhou:", err.message);
    return { ok: false, erro: err.message };
  } finally {
    emExecucao = false;
  }
}

module.exports = { calcularSaidas, processarExtratos, estaRodando, ultimaExecucao };
