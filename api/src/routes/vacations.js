/**
 * Férias — o que o CLIENTE vê no portal.
 *
 * Junta três coisas que já existem separadas: a Programação de Férias importada, o
 * salário que veio do Extrato Mensal e as regras do `vacationRules.js`. Nada é gravado
 * aqui: tudo é calculado na leitura, como nas licenças.
 *
 * O casamento com o funcionário é por **código** dentro da empresa (o mesmo nos dois
 * documentos) e, se faltar, por nome normalizado. Sem salário o custo fica **em branco**,
 * não zero — e o resumo conta quantos ficaram assim, para a tela poder avisar.
 */
const router = require("express").Router();
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { companyHasTool } = require("../middleware/companyToolAccess");
const { validateUUID } = require("../middleware/validate");
const { ultimaProgramacao } = require("../vacationImport");
const {
  situacao,
  limiteSeguranca,
  custoFerias,
  somarCustos,
  faltasParaProximaPerda,
  diasPorFaltas,
} = require("../vacationRules");

router.use(authMiddleware);

/** "JOSÉ DA SILVA" e "Jose da  Silva" viram a mesma chave. */
function normalizar(nome) {
  return String(nome || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Empresa da requisição: o cliente só vê a própria; o admin precisa dizer qual.
 * Devolve `{ erro }` quando não dá para decidir — nunca um padrão silencioso.
 */
function empresaDe(req) {
  if (req.isAdmin) {
    const id = (req.query.company_id || "").toString();
    if (!id) return { erro: "Informe company_id" };
    if (!validateUUID(id)) return { erro: "company_id inválido" };
    return { companyId: id };
  }
  if (!req.company?.id) return { erro: "Sessão de empresa inválida" };
  if (!companyHasTool(req, "vacations")) {
    return { erro: "Férias não está ativo para a sua empresa." };
  }
  return { companyId: req.company.id };
}

/** Salário por funcionário, indexado por código e por nome (nessa ordem de confiança). */
async function salariosDaEmpresa(companyId) {
  const { rows } = await db.query(
    `SELECT codigo, name, salario_base, salario_competencia
       FROM employees WHERE company_id = $1`,
    [companyId]
  );
  const porCodigo = new Map();
  const porNome = new Map();
  for (const e of rows) {
    const salario = e.salario_base === null ? null : Number(e.salario_base);
    if (salario === null || salario <= 0) continue;
    const dado = { salario, competencia: e.salario_competencia };
    if (e.codigo) porCodigo.set(String(e.codigo).replace(/^0+/, ""), dado);
    const chave = normalizar(e.name);
    if (chave && !porNome.has(chave)) porNome.set(chave, dado);
  }
  return { porCodigo, porNome };
}

/** Média salarial a partir do último snapshot da folha (fallback). */
async function mediaDaFolha(companyId, numFuncionariosFerias) {
  // Tenta snapshot com empregados primeiro
  const { rows } = await db.query(
    `SELECT proventos, empregados
       FROM payroll_snapshots
      WHERE company_id = $1 AND proventos > 0
      ORDER BY competencia DESC
      LIMIT 1`,
    [companyId]
  );
  if (!rows.length) return null;
  const proventos = Number(rows[0].proventos);
  const empregados = Number(rows[0].empregados);
  if (empregados > 0) {
    const media = proventos / empregados;
    if (Number.isFinite(media) && media > 0) return media;
  }
  // Sem empregados no snapshot: dividir pelo número de funcionários ativos
  const { rows: qtd } = await db.query(
    `SELECT COUNT(*)::int AS total FROM employees WHERE company_id = $1 AND active IS TRUE`,
    [companyId]
  );
  const totalFunc = qtd[0]?.total || 0;
  if (totalFunc > 0) {
    const media = proventos / totalFunc;
    if (Number.isFinite(media) && media > 0) return media;
  }
  // Último recurso: dividir pelo nº de funcionários na programação de férias
  if (numFuncionariosFerias > 0) {
    const media = proventos / numFuncionariosFerias;
    if (Number.isFinite(media) && media > 0) return media;
  }
  return null;
}

function enriquecer(periodos, salarios, mediaFolha, hoje = new Date()) {
  return periodos.map((p) => {
    const codigoNorm = p.codigo ? String(p.codigo).replace(/^0+/, "") : null;
    const achado =
      (codigoNorm && salarios.porCodigo.get(codigoNorm)) ||
      salarios.porNome.get(normalizar(p.nome)) ||
      null;
    const salario = achado?.salario ?? null;
    const salarioFinal = salario || mediaFolha || null;
    const origemSalario = salario ? "individual" : (mediaFolha ? "media_folha" : null);

    const diasDireito = Number(p.dias_direito) || 0;
    const diasGozados = Number(p.dias_gozados) || 0;
    const diasAPagar = Math.max(0, diasDireito - diasGozados);

    return {
      id: p.id,
      codigo: p.codigo,
      nome: p.nome,
      admissao: p.admissao,
      inicio_aquisitivo: p.inicio_aquisitivo,
      fim_aquisitivo: p.fim_aquisitivo,
      inicio_gozo: p.inicio_gozo,
      limite_gozo: p.limite_gozo,
      limite_seguranca: limiteSeguranca(p.limite_gozo),
      situacao: situacao(p.limite_gozo, hoje),
      dias_direito: diasDireito,
      dias_gozados: diasGozados,
      dias_acumulados: Number(p.dias_acumulados) || 0,
      dias_a_pagar: diasAPagar,
      faltas: p.faltas,
      alerta_faltas: faltasParaProximaPerda(p.faltas),
      dias_pela_tabela: diasPorFaltas(p.faltas),
      salario_base: salarioFinal,
      salario_competencia: achado?.competencia ?? null,
      origem_salario: origemSalario,
      custo: custoFerias(salarioFinal, diasAPagar),
    };
  });
}

/** A programação atual da empresa, já com custo, situação e alerta de faltas. */
router.get("/", async (req, res) => {
  try {
    const alvo = empresaDe(req);
    if (alvo.erro) return res.status(403).json({ error: alvo.erro });

    const prog = await ultimaProgramacao(db, alvo.companyId);
    if (!prog) {
      return res.json({ upload: null, periodos: [], resumo: null });
    }

    const salarios = await salariosDaEmpresa(alvo.companyId);
    const numFunc = new Set(prog.periodos.map((p) => p.nome)).size;
    const mediaFolha = await mediaDaFolha(alvo.companyId, numFunc);
    const periodos = enriquecer(prog.periodos, salarios, mediaFolha);

    const custos = periodos.map((p) => p.custo);
    const totais = somarCustos(custos);
    const funcionarios = new Set(periodos.map((p) => p.nome)).size;

    res.json({
      upload: prog.upload,
      periodos,
      resumo: {
        funcionarios,
        periodos: periodos.length,
        vencidas: periodos.filter((p) => p.situacao === "vencida").length,
        a_vencer: periodos.filter((p) => p.situacao === "a_vencer").length,
        // Quem está perto de perder dias por faltas — o alerta que interessa agir.
        em_risco_faltas: periodos.filter(
          (p) => p.alerta_faltas && p.alerta_faltas.faltasRestantes <= 3
        ).length,
        custo: totais,
      },
    });
  } catch (err) {
    console.error("[ferias cliente]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * Eventos para o calendário do cliente: o **limite de segurança** de cada período,
 * não o limite oficial. Marcar o limite oficial seria avisar no dia em que já não há
 * mais o que fazer; 30 dias antes ainda dá para programar as férias.
 */
router.get("/calendario", async (req, res) => {
  try {
    const alvo = empresaDe(req);
    if (alvo.erro) return res.status(403).json({ error: alvo.erro });

    const prog = await ultimaProgramacao(db, alvo.companyId);
    if (!prog) return res.json([]);

    const hoje = new Date();
    const eventos = prog.periodos
      .filter((p) => p.limite_gozo)
      .map((p) => ({
        data: limiteSeguranca(p.limite_gozo),
        limite_oficial: p.limite_gozo,
        nome: p.nome,
        dias: Number(p.dias_direito) || 0,
        situacao: situacao(p.limite_gozo, hoje),
      }))
      .filter((e) => e.data);

    res.json(eventos);
  } catch (err) {
    console.error("[ferias calendario]", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = { router, enriquecer, normalizar };
