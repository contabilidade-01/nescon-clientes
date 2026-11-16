/**
 * Advertência e suspensão fixadas para quem tem funcionário.
 *
 * Empresa que nasce pela sincronização do G-Click vem só com as seções de entregas
 * (PORTAL_ONLY_TOOL_ACCESS): o Departamento Pessoal fica desligado. Quando o extrato da
 * folha (ou uma planilha importada pelo escritório) mostra que ela tem funcionário de
 * verdade, o portal liga sozinho o que o cliente precisa para o dia a dia do DP:
 * advertência, suspensão, a lista de funcionários (para escolher ou cadastrar quem
 * entrou) e o histórico do que já foi emitido.
 *
 * Liga UMA vez por empresa (marca em companies.dp_auto_ligado_em). Se o escritório
 * desligar depois, pelo painel, a escolha dele vale e ninguém religa.
 *
 * "Funcionário de verdade" é a mesma regra das férias (payrollRoles.js): ativo e não
 * pró-labore. Estagiário conta.
 */
const { funcionarioFeriasSql } = require("./payrollRoles");

const DP_TOOLS_FIXADAS = ["warning", "suspension", "employees", "history"];

const PATCH_JSON = JSON.stringify(Object.fromEntries(DP_TOOLS_FIXADAS.map((k) => [k, true])));

/**
 * Liga advertência/suspensão (e a lista e o histórico) nas empresas com funcionário que
 * ainda não passaram por isso. `companyIds` limita a varredura; sem ele, varre todas.
 * Devolve as empresas ligadas agora. Nunca lança: é efeito colateral de outra rotina.
 */
async function fixarDpParaQuemTemFuncionarios(db, companyIds = null) {
  try {
    const filtro = Array.isArray(companyIds) && companyIds.length ? "AND c.id = ANY($2::uuid[])" : "";
    const params = [PATCH_JSON];
    if (filtro) params.push(companyIds);
    const { rows } = await db.query(
      `UPDATE companies c
          SET tool_access = COALESCE(c.tool_access, '{}'::jsonb) || $1::jsonb,
              dp_auto_ligado_em = now()
        WHERE c.dp_auto_ligado_em IS NULL
          AND c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE
          ${filtro}
          AND EXISTS (SELECT 1 FROM employees e WHERE e.company_id = c.id AND ${funcionarioFeriasSql("e")})
      RETURNING c.id, c.name`,
      params
    );
    if (rows.length) {
      console.log(
        `[dp fixado] advertência e suspensão ligadas em ${rows.length} empresa(s) com funcionário:`,
        rows.map((r) => r.name).join(", ")
      );
    }
    return rows;
  } catch (err) {
    console.error("[dp fixado] falhou:", err.message);
    return [];
  }
}

module.exports = { DP_TOOLS_FIXADAS, fixarDpParaQuemTemFuncionarios };
