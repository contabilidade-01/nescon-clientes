/**
 * Rotas de boletos Cora e honorários do painel admin.
 *
 * Extraído de routes/admin.js (que passava de 2.400 linhas) SEM mudança de comportamento:
 * recebe o MESMO `router` — já com authMiddleware + adminOnly aplicados em admin.js — e
 * apenas registra suas rotas nele. Mount, ordem entre rotas de paths distintos e os
 * middlewares `requireArea("sincronizacao")` de cada rota continuam idênticos.
 */
const db = require("../db");
const { requireArea } = require("../middleware/adminArea");
const { validateUUID } = require("../middleware/validate");
const numeroWpp = require("../whatsappNumero");
const { enviarDocumento } = require("../uazapi");
const cora = require("../cora");
const { hojeSP } = require("../diasBancarios");
const { urlPdfFresca } = require("../boletoPdf");
const { lerConfig } = require("../alertasConfig");
const {
  montarMensagemHonorario,
  montarMensagemVencimento,
  rodapeAutomatico,
  faseDe,
} = require("../honorariosCobranca");

module.exports = function registerBoletosRoutes(router) {
/** Lista boletos Cora importados (com nome da empresa). */
router.get("/cora/boletos", requireArea("sincronizacao"), async (req, res) => {
  try {
    const { company_id, status, competencia } = req.query;
    const params = [];
    let sql = `
      SELECT d.id, d.company_id, c.name AS empresa_nome, c.cnpj AS empresa_cnpj,
             d.title, d.competencia, to_char(d.due_date, 'YYYY-MM-DD') AS due_date,
             d.status, d.doc_type, d.external_ref, d.pdf_url, d.valor_centavos,
             d.created_at
      FROM deliverables d
      JOIN companies c ON c.id = d.company_id
      -- Cancelado na Cora nao e conta a pagar nem pagamento: some da tela dos dois
      -- lados. Continua no banco para explicar depois por que deixou de aparecer.
      WHERE d.source = 'cora' AND d.cancelado IS NOT TRUE
    `;
    if (company_id) {
      if (!validateUUID(company_id)) return res.status(400).json({ error: "company_id inválido" });
      params.push(company_id);
      sql += ` AND d.company_id = $${params.length}`;
    }
    if (status) {
      params.push(status);
      sql += ` AND d.status = $${params.length}`;
    }
    if (competencia) {
      params.push(competencia);
      sql += ` AND d.competencia = $${params.length}`;
    }
    sql += ` ORDER BY d.due_date DESC NULLS LAST, d.created_at DESC LIMIT 500`;
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro interno" });
  }
});

/**
 * DELETE /admin/cora/boletos/:id — cancelar (excluir) um boleto do portal.
 * Convenção: boleto cancelado não existe para o cliente.
 */
router.delete("/cora/boletos/:id", requireArea("sincronizacao"), async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
  try {
    const { rowCount } = await db.query(
      "DELETE FROM deliverables WHERE id = $1 AND source = 'cora'",
      [id]
    );
    if (!rowCount) return res.status(404).json({ error: "Boleto não encontrado" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[admin] deletar boleto cora:", err.message);
    res.status(500).json({ error: "Erro ao excluir boleto" });
  }
});

/**
 * POST /admin/cora/boletos/cancelar-atrasados — exclui todos os boletos Cora vencidos
 * e não pagos. Para quando a sync não funciona e precisa limpar a fila manualmente.
 */
router.post("/cora/boletos/cancelar-atrasados", requireArea("sincronizacao"), async (req, res) => {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM deliverables
        WHERE source = 'cora'
          AND status IS DISTINCT FROM 'paid'
          AND cancelado IS NOT TRUE
          AND due_date < CURRENT_DATE`
    );
    res.json({ ok: true, excluidos: rowCount });
  } catch (err) {
    console.error("[admin] cancelar atrasados cora:", err.message);
    res.status(500).json({ error: "Erro ao limpar boletos atrasados" });
  }
});

/**
 * POST /admin/cora/boletos/:id/enviar-whatsapp — envia o PDF do boleto diretamente no
 * WhatsApp da empresa. O admin escolhe qual boleto quer mandar; o sistema manda o
 * arquivo (não link) porque muitos clientes têm bloqueio de links automáticos.
 */
router.post("/cora/boletos/:id/enviar-whatsapp", requireArea("sincronizacao"), async (req, res) => {
  const { id } = req.params;
  if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });

  try {
    // Buscar boleto com dados da empresa. WhatsApp com o MESMO fallback do automático:
    // coluna manual `c.whatsapp` OU, na falta, o número do espelho G-Click (`g.phone`).
    // Sem esse fallback, o envio individual dava "sem WhatsApp" para a maioria (que tem
    // o número vindo do G-Click, não da coluna manual).
    const { rows } = await db.query(
      `SELECT d.id, d.pdf_url, d.external_ref, d.title, d.valor_centavos, d.is_honorario,
              d.honorario_cobrancas_enviadas AS count, d.competencia,
              to_char(d.due_date, 'YYYY-MM-DD') AS due_date,
              c.name AS empresa_nome,
              COALESCE(NULLIF(c.whatsapp, ''), g.phone) AS empresa_whatsapp
         FROM deliverables d
         JOIN companies c ON c.id = d.company_id
         LEFT JOIN gclick_clients g ON g.company_id = c.id
        WHERE d.id = $1 AND d.source = 'cora'`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Boleto não encontrado" });

    const boleto = rows[0];
    const v = numeroWpp.validar(boleto.empresa_whatsapp);
    if (!v.ok) {
      return res.status(400).json({ error: v.motivo || "Empresa não tem WhatsApp cadastrado" });
    }
    const numero = v.numero;

    const { enviarDocumento, enviarTexto } = require("../uazapi");
    const hoje = hojeSP();
    const venc = boleto.due_date ? boleto.due_date.split("-").reverse().join("/") : "";
    const valor = boleto.valor_centavos
      ? (boleto.valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : "";
    const portal = (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
    // Número do escritório para o rodapé "mensagem automática".
    const cfg = await lerConfig(db).catch(() => ({}));
    const contato = numeroWpp.formatar(cfg.escritorio_whatsapp || "");

    // A mensagem do MANUAL acompanha o AUTOMÁTICO: se o boleto está vencido, usa a régua
    // de honorário (a fase vem da contagem de cobranças já enviadas, igual ao automático);
    // se ainda vai vencer, manda o lembrete de vencimento.
    const vencido = boleto.due_date && boleto.due_date < hoje;
    let texto;
    if (vencido) {
      const diasAtraso = Math.floor((Date.now() - new Date(boleto.due_date).getTime()) / 86400000);
      texto = montarMensagemHonorario({
        empresa: boleto.empresa_nome, competencia: boleto.competencia, valor, venc,
        diasAtraso, fase: faseDe(Number(boleto.count) || 0), portal, contato,
      });
    } else {
      texto = montarMensagemVencimento({
        empresa: boleto.empresa_nome, competencia: boleto.competencia, valor, venc, portal, contato,
      });
    }

    // PDF buscado FRESCO na Cora (evita link expirado; dispensa o corte de competência).
    const fileUrl = await urlPdfFresca(boleto.external_ref, boleto.pdf_url);
    const docName = `Boleto_${boleto.empresa_nome.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}_${venc.replace(/\//g, "-")}.pdf`;

    if (fileUrl) {
      await enviarDocumento({ numero, fileUrl, docName, caption: texto, delayMs: 2000 });
    } else {
      // Sem PDF: manda ao menos o texto (com o link do portal como plano B).
      await enviarTexto({ numero, texto, delayMs: 1200 });
    }

    res.json({ ok: true, enviado_para: numero, tipo: vencido ? "cobranca" : "vencimento" });
  } catch (err) {
    if (err.constructor.name === "UazapiNaoConfigurado") {
      return res.status(400).json({ error: "WhatsApp (uazapi) não configurado no servidor" });
    }
    if (err.constructor.name === "UazapiTokenInvalido") {
      return res.status(400).json({ error: "WhatsApp desconectado — verifique o painel uazapi" });
    }
    console.error("[admin] enviar boleto whatsapp:", err.message);
    res.status(500).json({ error: "Falha ao enviar o boleto por WhatsApp" });
  }
});

/**
 * POST /admin/honorarios/cobrar-agora — disparo manual de cobrança de honorários.
 *
 * O admin aperta o botão, o sistema pega TODOS os boletos marcados como `is_honorario`
 * que estão pendentes (qualquer status que não seja 'paid'), e envia cada um por WhatsApp
 * DIRETO com o PDF. Cita o nome da empresa porque um mesmo telefone pode ter várias.
 *
 * Diferente do alerta automático (que dispara só nos marcos 1, 3, 5, 10, 15, 30), aqui
 * o disparo é manual: o admin decide quando cobrar, sem esperar o marco.
 *
 * Proteções:
 * - Trava de 48h: não envia se já cobrou o mesmo boleto nas últimas 48h (anti-duplicação)
 * - Dia da semana: só segunda a sexta (recusa no fim de semana)
 * - is_honorario: NUNCA cobra guia fiscal — só boletos explicitamente marcados
 * - Subchave honorario_cobranca_ativo por empresa: respeita
 *
 * Aceita filtros opcionais:
 * - `company_id`: cobrar só uma empresa
 * - `boleto_id`: cobrar só um boleto específico
 * - `ignorar_48h`: true para forçar mesmo que já tenha sido cobrado recentemente
 */
router.post("/honorarios/cobrar-agora", requireArea("sincronizacao"), async (req, res) => {
  const { company_id, boleto_id, ignorar_48h } = req.body || {};

  // Horário: só segunda a sexta. 0=dom, 6=sáb.
  const diaSemana = new Date().getDay();
  if (diaSemana === 0 || diaSemana === 6) {
    return res.status(400).json({
      error: "Cobrança de honorários só é enviada de segunda a sexta. Tente novamente no próximo dia útil.",
    });
  }

  try {
    const params = [];
    let filtro = "";
    if (boleto_id) {
      if (!validateUUID(boleto_id)) return res.status(400).json({ error: "boleto_id inválido" });
      params.push(boleto_id);
      filtro += ` AND d.id = $${params.length}`;
    } else if (company_id) {
      if (!validateUUID(company_id)) return res.status(400).json({ error: "company_id inválido" });
      params.push(company_id);
      filtro += ` AND d.company_id = $${params.length}`;
    }

    // Trava anti-duplicação: não cobra de novo se já mandou nas últimas 48h
    const trava48h = ignorar_48h
      ? ""
      : " AND (d.alert_sent_at IS NULL OR d.alert_sent_at < now() - interval '48 hours')";

    const { rows: boletos } = await db.query(
      `SELECT d.id, d.title, d.pdf_url, d.valor_centavos, d.is_honorario, d.external_ref,
              to_char(d.due_date, 'YYYY-MM-DD') AS due_date,
              c.id AS empresa_id, c.name AS empresa_nome,
              c.honorario_cobranca_ativo,
              COALESCE(NULLIF(c.whatsapp, ''), g.phone) AS whatsapp
         FROM deliverables d
         JOIN companies c ON c.id = d.company_id
         LEFT JOIN gclick_clients g ON g.company_id = c.id
        WHERE d.category = 'boleto'
          AND d.is_honorario = true
          AND d.status IS DISTINCT FROM 'paid'
          AND d.cancelado IS NOT TRUE
          AND d.released_at IS NOT NULL
          AND d.due_date IS NOT NULL
          AND d.due_date < CURRENT_DATE
          -- Respeitar a subchave por empresa + cliente inativo não é cobrado nem no manual
          AND c.honorario_cobranca_ativo IS NOT FALSE
          AND c.arquivada IS NOT TRUE
          AND c.excluida IS NOT TRUE
          ${trava48h}
          ${filtro}
        ORDER BY d.due_date ASC`,
      params
    );

    if (!boletos.length) {
      return res.json({ enviados: 0, erros: [], mensagem: "Nenhum honorário em atraso para cobrar (todos já cobrados ou pagos)." });
    }

    const enviados = [];
    const erros = [];

    // URL do portal para download direto do boleto
    const portalBase = (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
    // Número do escritório para o rodapé "mensagem automática".
    const cfgCobranca = await lerConfig(db).catch(() => ({}));
    const contatoCobranca = numeroWpp.formatar(cfgCobranca.escritorio_whatsapp || "");

    for (const b of boletos) {
      // Checagem fresca na Cora: não cobrar o que já consta pago/compensado lá, mesmo que
      // o banco local ainda diga pendente (sync de 6h pode estar defasado). Best-effort —
      // se a Cora não responder, segue com o status do banco.
      try {
        const invoiceId = String(b.external_ref || "").replace(/^cora_/, "");
        if (invoiceId) {
          const detalhe = await cora.getInvoiceDetail(invoiceId);
          if (detalhe && detalhe.status && cora.mapCoraStatusToPortal(detalhe.status) === "paid") {
            await db.query("UPDATE deliverables SET status='paid', paid_at=now() WHERE id=$1", [b.id]);
            erros.push({ empresa: b.empresa_nome, motivo: "Já consta pago na Cora — não cobrado" });
            continue;
          }
        }
      } catch (e) {
        console.error("[admin] cobrar honorarios: checagem Cora", b.id, e.message);
      }

      const v = numeroWpp.validar(b.whatsapp);
      if (!v.ok) {
        erros.push({ empresa: b.empresa_nome, motivo: v.motivo });
        continue;
      }

      if (!b.pdf_url) {
        erros.push({ empresa: b.empresa_nome, motivo: "Sem PDF disponível" });
        continue;
      }

      const venc = b.due_date ? b.due_date.split("-").reverse().join("/") : "";
      const valor = b.valor_centavos
        ? (b.valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
        : "";
      const diasAtraso = b.due_date
        ? Math.floor((Date.now() - new Date(b.due_date).getTime()) / 86400000)
        : 0;

      const docName = `Honorarios_${b.empresa_nome.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}_${venc.replace(/\//g, "-")}.pdf`;

      // Link do portal para o cliente baixar (caso o PDF expire depois)
      const linkBoleto = portalBase ? `${portalBase}/boletos` : "";

      // Texto do WhatsApp com aviso amigável mas firme
      const caption = [
        `📌 *Cobrança de Honorários — ${b.empresa_nome}*`,
        "",
        `Vencimento: ${venc}`,
        valor ? `Valor: ${valor}` : null,
        diasAtraso > 0 ? `Dias em atraso: ${diasAtraso}` : null,
        "",
        "⚠️ Caro cliente, honorários com mais de 5 dias de atraso podem levar ao bloqueio dos serviços de entregas de declarações. Essas declarações têm multas que, na maioria das vezes, ultrapassam o valor dos honorários.",
        "",
        linkBoleto ? `📎 Baixe o boleto atualizado no portal: ${linkBoleto}` : null,
        "",
        "Se já pagou, desconsidere. Qualquer dúvida, entre em contato com o escritório. 🙏",
        "",
        "_Nescon Contabilidade_",
        rodapeAutomatico(contatoCobranca),
      ].filter(Boolean).join("\n");

      try {
        await enviarDocumento({
          numero: v.numero,
          fileUrl: b.pdf_url,
          docName,
          caption,
          delayMs: 2000,
        });

        // Atualizar alert_sent_at para não reenviar nas próximas 48h (anti-duplicação)
        await db.query("UPDATE deliverables SET alert_sent_at = now() WHERE id = $1", [b.id]);
        enviados.push({ empresa: b.empresa_nome, boleto_id: b.id, enviado_para: v.numero });
      } catch (err) {
        erros.push({ empresa: b.empresa_nome, motivo: err.message });
        // Se token inválido, para tudo — não adianta continuar
        if (err.constructor.name === "UazapiTokenInvalido") {
          erros.push({ empresa: "GERAL", motivo: "WhatsApp desconectado — cobrança interrompida" });
          break;
        }
      }

      // Pausa entre envios para não parecer spam
      if (boletos.indexOf(b) < boletos.length - 1) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    res.json({
      enviados: enviados.length,
      erros,
      total: boletos.length,
      resultados: enviados,
    });
  } catch (err) {
    console.error("[admin] cobrar honorarios:", err.message);
    res.status(500).json({ error: "Falha ao processar cobrança de honorários" });
  }
});

/**
 * GET /admin/honorarios — lista honorários com status de cobrança.
 */
router.get("/honorarios", requireArea("sincronizacao"), async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT d.id, d.title, d.pdf_url, d.valor_centavos, d.status,
              to_char(d.due_date, 'YYYY-MM-DD') AS due_date, d.competencia,
              d.alert_sent_at, d.created_at,
              c.name AS empresa_nome, c.cnpj AS empresa_cnpj,
              COALESCE(NULLIF(c.whatsapp, ''), g.phone) AS whatsapp
         FROM deliverables d
         JOIN companies c ON c.id = d.company_id
         LEFT JOIN gclick_clients g ON g.company_id = c.id
        WHERE d.category = 'boleto'
          AND d.is_honorario = true
          AND d.cancelado IS NOT TRUE
        ORDER BY d.due_date DESC NULLS LAST
        LIMIT 200`
    );
    res.json(rows);
  } catch (err) {
    console.error("[admin] listar honorarios:", err.message);
    res.status(500).json({ error: "Erro ao listar honorários" });
  }
});

/**
 * PUT /admin/honorarios/:id/marcar — marca/desmarca boleto como honorário.
 * O admin pode marcar qualquer boleto Cora como honorário para mudar os marcos de cobrança.
 */
router.put("/honorarios/:id/marcar", requireArea("sincronizacao"), async (req, res) => {
  const { id } = req.params;
  const { is_honorario } = req.body || {};
  if (!validateUUID(id)) return res.status(400).json({ error: "ID inválido" });
  if (typeof is_honorario !== "boolean") return res.status(400).json({ error: "is_honorario deve ser booleano" });

  try {
    const { rowCount } = await db.query(
      "UPDATE deliverables SET is_honorario = $1 WHERE id = $2 AND source = 'cora'",
      [is_honorario, id]
    );
    if (!rowCount) return res.status(404).json({ error: "Boleto não encontrado" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[admin] marcar honorario:", err.message);
    res.status(500).json({ error: "Erro ao marcar honorário" });
  }
});

/**
 * POST /admin/honorarios/marcar-todos — marca TODOS os boletos Cora como honorários.
 * Atalho para quem só emite boleto de honorário pela Cora (caso da Nescon).
 */
router.post("/honorarios/marcar-todos", requireArea("sincronizacao"), async (_req, res) => {
  try {
    const { rowCount } = await db.query(
      "UPDATE deliverables SET is_honorario = true WHERE source = 'cora' AND category = 'boleto' AND is_honorario IS NOT TRUE"
    );
    res.json({ ok: true, marcados: rowCount });
  } catch (err) {
    console.error("[admin] marcar todos honorarios:", err.message);
    res.status(500).json({ error: "Erro ao marcar todos como honorários" });
  }
});
};
