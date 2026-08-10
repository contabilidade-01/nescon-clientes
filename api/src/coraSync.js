/**
 * Puxa os boletos da API Cora para o portal.
 *
 * Espelho do padrão em `gclick/sync.js`: reentrancy guard, agendador periódico,
 * carga inicial e UPSERT em `deliverables` com `source='cora'`.
 *
 * O boleto Cora já nasce LIBERADO (released_at = now()): diferente das guias do
 * G-Click, que passam por liberação do escritório. Boleto é cobrança ao cliente —
 * não faz sentido retê-lo.
 */
const crypto = require("crypto");
const db = require("./db");
const cora = require("./cora");

const MESES_PADRAO = Number(process.env.CORA_SYNC_MESES || 6);
const CONCORRENCIA = 4;

let emExecucao = false;
let ultimoResultado = null;

function estaRodando() {
  return emExecucao;
}

function ultimaExecucao() {
  return ultimoResultado;
}

/**
 * Controle de concorrência simples (igual ao client.mapLimit do G-Click).
 */
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Gera range de datas para os últimos N meses.
 */
function rangeUltimosMeses(meses) {
  const hoje = new Date();
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0); // último dia do mês atual
  const ini = new Date(hoje.getFullYear(), hoje.getMonth() - meses + 1, 1); // 1º dia de N meses atrás
  return {
    start: ini.toISOString().split("T")[0],
    end: fim.toISOString().split("T")[0],
  };
}

/**
 * Competência de um boleto a partir da data de vencimento.
 * Se vence em 20/08/2026 → competência 2026-08.
 */
function competenciaDe(dueDate) {
  if (!dueDate) return null;
  // dueDate vem como "YYYY-MM-DD" da Cora
  const parts = String(dueDate).split("-");
  if (parts.length < 2) return null;
  return `${parts[0]}-${parts[1]}`;
}

/**
 * Grava ou atualiza um boleto Cora em `deliverables`.
 *
 * Chave de idempotência: `external_ref = 'cora_{invoiceId}'` com o índice único
 * parcial em `(company_id, external_ref) WHERE external_ref IS NOT NULL`.
 */
async function gravarBoleto(boleto, companyId) {
  const externalRef = `cora_${boleto.id}`;
  const status = cora.mapCoraStatusToPortal(boleto.status);
  const dueDate = boleto.due_date || null;
  const competencia = competenciaDe(dueDate);
  const pdfUrl = boleto.payment_options?.bank_slip?.url || null;
  const valorCentavos = boleto.total_amount || null;
  const paidAt = status === "paid" ? "now()" : "NULL";

  // Tentar buscar existente
  const { rows: existentes } = await db.query(
    "SELECT id, status, pdf_url FROM deliverables WHERE company_id = $1 AND external_ref = $2",
    [companyId, externalRef]
  );

  if (existentes.length) {
    const atual = existentes[0];
    // Checar se algo mudou
    if (atual.status === status && atual.pdf_url === pdfUrl) {
      return "sem-mudanca";
    }
    // Atualizar
    await db.query(
      `UPDATE deliverables
       SET status = $1, paid_at = ${paidAt}, pdf_url = $2, valor_centavos = $3
       WHERE id = $4`,
      [status, pdfUrl, valorCentavos, atual.id]
    );
    return "atualizado";
  }

  // Criar novo
  const title = dueDate
    ? `Boleto ${dueDate.split("-").reverse().join("/")}`
    : "Boleto Cora";

  await db.query(
    `INSERT INTO deliverables
       (company_id, category, doc_type, title, competencia, due_date,
        file_path, file_name, source, external_ref, access_token,
        released_at, status, paid_at, pdf_url, valor_centavos)
     VALUES ($1, 'boleto', 'BOLETO_CORA', $2, $3, $4,
             '', '', 'cora', $5, $6,
             now(), $7, ${paidAt}, $8, $9)`,
    [
      companyId,
      title,
      competencia,
      dueDate,
      externalRef,
      crypto.randomBytes(24).toString("hex"),
      status,
      pdfUrl,
      valorCentavos,
    ]
  );
  return "criado";
}

/**
 * Sincroniza boletos Cora para todas as empresas com `tool_access->'boletos' = true`.
 */
async function sincronizar({ cnpjFiltro = null } = {}) {
  if (!cora.isConfigured()) {
    return { ok: false, erro: "Cora não configurado (certificados não encontrados)" };
  }
  if (emExecucao) return { ok: false, erro: "Já existe uma sincronização em andamento" };

  emExecucao = true;
  const inicio = Date.now();
  const total = { criados: 0, atualizados: 0, semMudanca: 0, erros: 0, empresasProcessadas: 0 };

  try {
    // Buscar empresas com boletos ativo
    let sql = `SELECT id, cnpj FROM companies WHERE cnpj IS NOT NULL AND cnpj != ''`;
    const params = [];

    if (cnpjFiltro) {
      params.push(cnpjFiltro.replace(/\D/g, ""));
      sql += ` AND REPLACE(cnpj, '.', '') = $${params.length}`;
    }

    // Filtrar por tool_access: só empresas com 'boletos' habilitado
    // tool_access é JSONB — se null, tem acesso a tudo (empresa legada)
    sql += ` AND (tool_access IS NULL OR tool_access->>'boletos' = 'true')`;

    const { rows: empresas } = await db.query(sql, params);

    if (!empresas.length) {
      ultimoResultado = {
        ...total,
        segundos: 0,
        em: new Date().toISOString(),
      };
      return { ok: true, ...ultimoResultado };
    }

    const { start, end } = rangeUltimosMeses(MESES_PADRAO);

    await mapLimit(empresas, CONCORRENCIA, async (empresa) => {
      const cnpj = String(empresa.cnpj).replace(/\D/g, "");
      if (!cnpj || cnpj.length < 11) return; // CNPJ inválido

      try {
        const result = await cora.searchInvoices(cnpj, { start, end });
        const items = result?.items || [];

        if (!items.length) return;

        total.empresasProcessadas++;

        for (const boleto of items) {
          if (!boleto.id) continue;
          // Ignorar drafts que não foram emitidos
          if (boleto.status === "DRAFT" || boleto.status === "RECURRENCE_DRAFT") continue;

          try {
            const r = await gravarBoleto(boleto, empresa.id);
            if (r === "criado") total.criados++;
            else if (r === "atualizado") total.atualizados++;
            else if (r === "sem-mudanca") total.semMudanca++;
          } catch (err) {
            console.error(`[cora] boleto ${boleto.id} empresa ${cnpj}:`, err.message);
            total.erros++;
          }
        }
      } catch (err) {
        console.error(`[cora] empresa ${cnpj}:`, err.message);
        total.erros++;
      }
    });

    ultimoResultado = {
      ...total,
      segundos: Math.round((Date.now() - inicio) / 1000),
      em: new Date().toISOString(),
    };
    console.log("[cora] sync concluída:", JSON.stringify(ultimoResultado));
    return { ok: true, ...ultimoResultado };
  } finally {
    emExecucao = false;
  }
}

/**
 * Agendamento periódico (CORA_SYNC_INTERVAL_H; 0 = desligado) + 1ª carga no arranque.
 */
function iniciarAgendador() {
  if (!cora.isConfigured()) {
    console.log("[cora] certificados não encontrados — sync desligada.");
    return;
  }

  const horas = Number(process.env.CORA_SYNC_INTERVAL_H || 0);
  const cargaInicial = process.env.CORA_SYNC_ON_BOOT !== "false";

  if (cargaInicial) {
    setTimeout(async () => {
      try {
        const { rows } = await db.query(
          "SELECT 1 FROM deliverables WHERE source = 'cora' LIMIT 1"
        );
        if (rows.length) {
          console.log("[cora] já há boletos sincronizados; pulando carga inicial.");
          return;
        }
        console.log("[cora] carga inicial (portal sem boletos Cora)...");
        await sincronizar();
      } catch (err) {
        console.error("[cora] carga inicial falhou:", err.message);
      }
    }, 10000).unref(); // 10s (2s depois do G-Click, para não competir)
  }

  if (horas > 0) {
    const ms = horas * 3600 * 1000;
    setInterval(() => {
      sincronizar().catch((err) => console.error("[cora] ciclo periódico:", err.message));
    }, ms).unref();
    console.log(`[cora] agendador ligado: a cada ${horas}h`);
  }
}

module.exports = { sincronizar, iniciarAgendador, estaRodando, ultimaExecucao };
