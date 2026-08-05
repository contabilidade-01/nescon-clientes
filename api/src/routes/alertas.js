/**
 * Painel de alertas de vencimento.
 *
 * O escritório marca aqui quais obrigações cada empresa recebe, liga/desliga o cliente
 * que não quer mensagem, e vê o texto exato que sairia hoje antes de qualquer coisa ser
 * enviada. Nada aqui fala com o sistema de guias: é o portal assumindo o aviso.
 */
const router = require("express").Router();
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { requireArea } = require("../middleware/adminArea");
const { validateUUID, validateString } = require("../middleware/validate");
const { OBRIGACOES, calcularVencimento } = require("../obrigacoes");
const { hojeSP } = require("../diasBancarios");
const {
  aplicarAutomaticas,
  detalheDaEmpresa,
  decidir,
  panorama,
  previsao,
  registrarEnvio,
  salvarPreferencias,
} = require("../alertas");
const { enviarAlertasDoDia } = require("../alertasEnvio");
const { statusInstancia } = require("../uazapi");

function adminOnly(req, res, next) {
  if (!req.isAdmin) return res.status(403).json({ error: "Acesso restrito a administradores" });
  next();
}

router.use(authMiddleware);
router.use(adminOnly);
router.use(requireArea("alertas"));

/**
 * Catálogo com o vencimento do mês corrente já calculado — é o que deixa a tela útil
 * para conferência: o escritório bate a data contra a tabela dele num relance.
 */
router.get("/catalogo", (req, res) => {
  const hoje = hojeSP();
  const ano = Number(hoje.slice(0, 4));
  const mes = Number(hoje.slice(5, 7));
  res.json({
    referencia: `${String(mes).padStart(2, "0")}/${ano}`,
    obrigacoes: OBRIGACOES.map((o) => {
      const v = calcularVencimento(o.codigo, ano, mes);
      return {
        codigo: o.codigo,
        nome: o.nome,
        esfera: o.esfera,
        regra:
          o.regra.tipo === "dia_fixo"
            ? `dia ${o.regra.dia} — ${o.regra.ajuste === "proximo" ? "próximo dia bancário" : "dia bancário anterior"}`
            : o.regra.tipo === "ultimo_dia_bancario"
              ? "último dia bancário do mês"
              : "5º dia útil",
        automatica: Boolean(o.auto),
        avisar_dias_antes: o.avisarDiasAntes,
        vencimento_no_mes: v?.data ?? null,
        observacao: v?.observacao ?? null,
      };
    }),
  });
});

/** Lista de empresas, com busca por nome ou CNPJ. */
router.get("/", async (req, res) => {
  try {
    res.json(await panorama(db, { busca: req.query.busca }));
  } catch (err) {
    console.error("[alertas] panorama:", err.message);
    res.status(500).json({ error: "Erro ao carregar o panorama de alertas" });
  }
});

/** Detalhe de uma empresa: marcadas, recusadas e o que o portal sugere. */
router.get("/empresas/:id", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "id inválido" });
  try {
    const d = await detalheDaEmpresa(db, req.params.id);
    if (!d) return res.status(404).json({ error: "Empresa não encontrada" });
    res.json(d);
  } catch (err) {
    console.error("[alertas] detalhe:", err.message);
    res.status(500).json({ error: "Erro ao carregar a empresa" });
  }
});

/** Marca ou desmarca uma obrigação. Desmarcar também é decisão: a sugestão não volta. */
router.put("/empresas/:id/obrigacoes", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "id inválido" });
  const { codigo, ativo, observacao } = req.body || {};
  if (!validateString(codigo, 1, 40)) return res.status(400).json({ error: "codigo inválido" });
  if (typeof ativo !== "boolean") return res.status(400).json({ error: "ativo deve ser booleano" });
  if (observacao !== undefined && observacao !== null && !validateString(observacao, 0, 300)) {
    return res.status(400).json({ error: "observacao inválida" });
  }
  try {
    const r = await decidir(db, req.params.id, codigo, ativo, observacao ?? null);
    if (!r) return res.status(400).json({ error: "Obrigação desconhecida" });
    res.json(r);
  } catch (err) {
    console.error("[alertas] decidir:", err.message);
    res.status(500).json({ error: "Erro ao gravar a decisão" });
  }
});

/** Ligar/desligar alertas e incentivo da empresa, e o número de WhatsApp. */
router.put("/empresas/:id/preferencias", async (req, res) => {
  if (!validateUUID(req.params.id)) return res.status(400).json({ error: "id inválido" });
  const { alertas_ativos, incentivo_ativo, whatsapp } = req.body || {};
  if (whatsapp !== undefined && whatsapp !== null && !validateString(String(whatsapp), 0, 20)) {
    return res.status(400).json({ error: "whatsapp inválido" });
  }
  try {
    const r = await salvarPreferencias(db, req.params.id, {
      alertasAtivos: alertas_ativos,
      incentivoAtivo: incentivo_ativo,
      whatsapp,
    });
    if (!r) return res.status(400).json({ error: "Nada para salvar" });
    // Número recusado volta com o motivo específico (fixo, formato) para o admin
    // corrigir o cadastro em vez de investigar um envio que nunca chega.
    if (r.erro) return res.status(400).json({ error: r.erro });
    res.json(r);
  } catch (err) {
    console.error("[alertas] preferencias:", err.message);
    res.status(500).json({ error: "Erro ao salvar as preferências" });
  }
});

/**
 * Roda a marcação automática na carteira inteira. Idempotente e conservadora: nunca
 * mexe no que já foi decidido à mão.
 */
router.post("/aplicar-automaticas", async (req, res) => {
  try {
    res.json(await aplicarAutomaticas(db, null));
  } catch (err) {
    console.error("[alertas] automáticas:", err.message);
    res.status(500).json({ error: "Erro ao aplicar as marcações automáticas" });
  }
});

/**
 * Pré-visualização: o que sairia hoje (ou na data pedida), com o texto pronto.
 * Não grava e não consome o rodízio de mensagens de incentivo.
 */
router.get("/previsao", async (req, res) => {
  const data = req.query.data ? String(req.query.data) : null;
  if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return res.status(400).json({ error: "data deve ser YYYY-MM-DD" });
  }
  try {
    res.json(await previsao(db, { data, simular: true }));
  } catch (err) {
    console.error("[alertas] previsao:", err.message);
    res.status(500).json({ error: "Erro ao montar a previsão" });
  }
});

/**
 * Registra que o alerta foi entregue ao cliente. Fica separado do envio de propósito:
 * enquanto o WhatsApp sai por fora, o escritório marca aqui o que já mandou e o portal
 * não repete. Quando o envio passar a ser do portal, ele chama esta mesma função.
 */
router.post("/registrar-envio", async (req, res) => {
  const { company_id, obrigacoes, dia_alerta, texto, incentivo_id } = req.body || {};
  if (!validateUUID(company_id)) return res.status(400).json({ error: "company_id inválido" });
  if (!Array.isArray(obrigacoes) || !obrigacoes.length) {
    return res.status(400).json({ error: "obrigacoes deve ser uma lista não vazia" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia_alerta || ""))) {
    return res.status(400).json({ error: "dia_alerta deve ser YYYY-MM-DD" });
  }
  if (!validateString(texto, 1, 4000)) return res.status(400).json({ error: "texto inválido" });
  try {
    const r = await registrarEnvio(db, {
      companyId: company_id,
      obrigacoes,
      diaAlerta: dia_alerta,
      texto,
      incentivoId: incentivo_id || null,
    });
    res.json({ registrado: Boolean(r), id: r?.id ?? null });
  } catch (err) {
    console.error("[alertas] registrar-envio:", err.message);
    res.status(500).json({ error: "Erro ao registrar o envio" });
  }
});

/** Estado da instância de WhatsApp. Nunca falha: devolve o diagnóstico como dado. */
router.get("/whatsapp", async (_req, res) => {
  res.json(await statusInstancia());
});

/**
 * Dispara os alertas do dia.
 *
 * `simular: true` (padrão) monta tudo, aplica as validações de número e **não envia** —
 * é o ensaio que mostra quem ficaria de fora e por quê. Enviar de verdade exige pedir
 * explicitamente, porque é ação que chega no cliente e não tem desfazer.
 */
router.post("/enviar", async (req, res) => {
  const simular = req.body?.simular !== false;
  const data = req.body?.data ? String(req.body.data) : null;
  if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return res.status(400).json({ error: "data deve ser YYYY-MM-DD" });
  }
  try {
    const r = await enviarAlertasDoDia(db, { data, apenasSimular: simular });
    res.json({ simulado: simular, ...r });
  } catch (err) {
    console.error("[alertas] enviar:", err.message);
    res.status(500).json({ error: "Erro ao disparar os alertas" });
  }
});

module.exports = router;
