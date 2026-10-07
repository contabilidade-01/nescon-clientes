/**
 * Guias do MEI (DAS e parcelamento) enviadas pelo WhatsApp a pedido do central-ecac.
 *
 * O central-ecac gera a guia (SERPRO) e entrega o PDF aqui; este portal continua dono do
 * contato, da janela de envio, do teto por hora, do opt-out e do histórico — o mesmo
 * conjunto de travas do `docNotify.js`. Diferença: sai o PDF ANEXADO, não só o aviso.
 * O cliente MEI não precisa de acesso ao portal: o anexo vem da URL pública do
 * `deliverable` (token longo, só com `released_at`).
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const uazapi = require("./uazapi");
const numeroWpp = require("./whatsappNumero");
const { whatsappSql, JOIN_ESPELHO } = require("./alertas");
const { sobOTeto, marcarEnviado } = require("./alertasEnvio");
const { podeEnviarAgora, podeDrenar } = require("./docNotify");
const { minutosSP } = require("./diasBancarios");
const { UPLOAD_DIR } = require("./uploads");

const TIPOS = {
  DAS_MEI: "DAS MEI",
  PARCELAMENTO_MEI: "Parcelamento MEI",
};
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_TENTATIVAS = 5;

const soDigitos = (v) => String(v || "").replace(/\D/g, "");

/** AAAAMM → MM/AAAA. */
function competenciaBr(aaaamm) {
  const c = soDigitos(aaaamm);
  return c.length === 6 ? `${c.slice(4)}/${c.slice(0, 4)}` : String(aaaamm || "");
}

/** AAAAMMDD ou AAAA-MM-DD → AAAA-MM-DD válido, ou null. */
function dataIso(v) {
  const d = soDigitos(v);
  if (d.length !== 8) return null;
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso;
}

function dataBr(iso) {
  return iso ? iso.split("-").reverse().join("/") : null;
}

function valorBr(v) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function montarCaption({ nomeEmpresa, tipo, competencia, vencimento, valor }) {
  const rotulo = TIPOS[tipo] || tipo;
  return [
    `Olá! Segue a guia do ${rotulo} de ${nomeEmpresa}.`,
    `Competência: ${competenciaBr(competencia)}`,
    vencimento ? `Vencimento: ${dataBr(vencimento)}` : null,
    valor != null && valor !== "" && !Number.isNaN(Number(valor)) ? `Valor: ${valorBr(valor)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Valida o corpo da rota. Devolve { erro } ou { dados } já normalizado. */
function validarPedido(corpo) {
  const c = corpo || {};
  const cnpj = soDigitos(c.cnpj);
  if (cnpj.length !== 14) return { erro: "cnpj inválido" };
  if (!TIPOS[c.tipo]) return { erro: `tipo deve ser ${Object.keys(TIPOS).join(" ou ")}` };
  const competencia = soDigitos(c.competencia);
  const mes = Number(competencia.slice(4));
  if (competencia.length !== 6 || mes < 1 || mes > 12) return { erro: "competencia deve ser AAAAMM" };
  const externalRef = String(c.external_ref || "").trim();
  if (!externalRef || externalRef.length > 120) return { erro: "external_ref obrigatório (até 120 caracteres)" };
  const vencimento = c.vencimento ? dataIso(c.vencimento) : null;
  if (c.vencimento && !vencimento) return { erro: "vencimento inválido (AAAAMMDD)" };
  let valor = null;
  if (c.valor != null && c.valor !== "") {
    valor = Number(c.valor);
    if (!Number.isFinite(valor) || valor < 0) return { erro: "valor inválido" };
  }
  const pdf = Buffer.from(String(c.pdf_base64 || ""), "base64");
  if (!pdf.length || pdf.subarray(0, 4).toString() !== "%PDF") return { erro: "pdf_base64 deve ser um PDF" };
  if (pdf.length > MAX_PDF_BYTES) return { erro: "PDF acima de 8 MB" };
  return {
    dados: { cnpj, tipo: c.tipo, competencia, externalRef, vencimento, valor, pdf, forcar: c.forcar === true },
  };
}

async function carregarEmpresaPorCnpj(db, cnpj) {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.avisos_documentos_ativos, ${whatsappSql("c")} AS whatsapp
       FROM companies c ${JOIN_ESPELHO}
      WHERE regexp_replace(c.cnpj, '\\D', '', 'g') = $1
        AND c.arquivada IS NOT TRUE AND c.excluida IS NOT TRUE
      LIMIT 1`,
    [cnpj]
  );
  return rows[0] || null;
}

/** A empresa existe aqui e tem WhatsApp válido? Não expõe número nem e-mail. */
async function vinculo(db, cnpjBruto) {
  const cnpj = soDigitos(cnpjBruto);
  if (cnpj.length !== 14) return { vinculada: false, whatsapp_valido: false, motivo: "cnpj inválido" };
  const e = await carregarEmpresaPorCnpj(db, cnpj);
  if (!e) return { vinculada: false, whatsapp_valido: false, motivo: "empresa não cadastrada no Nescon Clientes" };
  const v = numeroWpp.validar(e.whatsapp);
  return {
    vinculada: true,
    nome: e.name,
    whatsapp_valido: v.ok,
    motivo: v.ok ? null : v.motivo,
    avisos_ativos: e.avisos_documentos_ativos !== false,
  };
}

function urlPublica(token) {
  const base = (process.env.PUBLIC_APP_URL || "").replace(/\/+$/, "");
  return base ? `${base}/api/deliverables/public/${token}/file` : null;
}

async function marcar(db, id, status, motivo, extra = {}) {
  await db.query(
    `UPDATE guias_mei_envios
        SET status=$2, motivo=$3, numero=COALESCE($4, numero),
            enviado_em = CASE WHEN $2 = 'enviada' THEN now() ELSE enviado_em END,
            tentativas = tentativas + $5, atualizado_em = now()
      WHERE id=$1`,
    [id, status, motivo ?? null, extra.numero ?? null, extra.tentativa ? 1 : 0]
  );
}

/**
 * Tenta mandar UMA guia. Nunca lança. Devolve { status, motivo }.
 * `diferirSeForaDaJanela`: o envio na hora respeita 08–19h dias úteis como o docNotify.
 */
async function tentarEnvio(db, envio, { forcarAgora = false } = {}) {
  try {
    if (!uazapi.configurado()) return { status: "falhou", motivo: "uazapi não configurada" };
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.avisos_documentos_ativos, ${whatsappSql("c")} AS whatsapp,
              d.access_token, d.file_name
         FROM guias_mei_envios g
         JOIN companies c ON c.id = g.company_id ${JOIN_ESPELHO}
         JOIN deliverables d ON d.id = g.deliverable_id
        WHERE g.id = $1`,
      [envio.id]
    );
    if (!rows.length) return { status: "falhou", motivo: "empresa ou documento não encontrado" };
    const e = rows[0];
    if (e.avisos_documentos_ativos === false) {
      return { status: "ignorada", motivo: "cliente desativou avisos de documento" };
    }
    const v = numeroWpp.validar(e.whatsapp);
    if (!v.ok) return { status: "sem_whatsapp", motivo: v.motivo };
    if (!forcarAgora && !podeEnviarAgora(minutosSP())) {
      return { status: "na_fila", motivo: "Fora do horário (08–19h): sai no próximo dia útil a partir das 07:50" };
    }
    const meuNumero = await uazapi.owner();
    if (meuNumero && v.numero === meuNumero) {
      return { status: "falhou", motivo: "é o próprio número da instância" };
    }
    if (!sobOTeto()) return { status: "na_fila", motivo: "Teto de envios/hora atingido: sai no próximo ciclo" };
    const fileUrl = urlPublica(e.access_token);
    if (!fileUrl) return { status: "falhou", motivo: "PUBLIC_APP_URL não configurada" };

    await uazapi.enviarDocumento({
      numero: v.numero,
      fileUrl,
      docName: e.file_name,
      caption: montarCaption({
        nomeEmpresa: e.name, tipo: envio.tipo, competencia: envio.competencia,
        vencimento: envio.vencimento, valor: envio.valor,
      }),
      delayMs: 1500,
    });
    marcarEnviado();
    return { status: "enviada", motivo: null, numero: v.numero };
  } catch (err) {
    const definitiva = err instanceof uazapi.UazapiDestinoNaoPermitido;
    return { status: definitiva ? "falhou" : "na_fila", motivo: err.message, transitoria: !definitiva };
  }
}

async function aplicarResultado(db, envio, r) {
  // na_fila por erro transitório conta tentativa; ao estourar o limite vira falhou.
  const tentativas = (envio.tentativas || 0) + (r.status === "na_fila" && r.transitoria ? 1 : 0);
  if (r.status === "na_fila" && r.transitoria && tentativas >= MAX_TENTATIVAS) {
    await marcar(db, envio.id, "falhou", `${r.motivo} (após ${MAX_TENTATIVAS} tentativas)`, { tentativa: true });
    return { status: "falhou", motivo: r.motivo };
  }
  await marcar(db, envio.id, r.status, r.motivo, { numero: r.numero, tentativa: r.status !== "na_fila" || r.transitoria });
  return { status: r.status, motivo: r.motivo };
}

/** Rota POST /guia-mei. Idempotente por external_ref; `forcar` reenvia. */
async function receberGuia(db, dados) {
  const empresa = await carregarEmpresaPorCnpj(db, dados.cnpj);
  if (!empresa) return { http: 404, ok: false, status: "sem_cadastro", motivo: "empresa não cadastrada no Nescon Clientes" };

  const { rows: ja } = await db.query(`SELECT * FROM guias_mei_envios WHERE external_ref=$1`, [dados.externalRef]);
  let envio = ja[0];
  if (envio && envio.company_id !== empresa.id) {
    return { http: 409, ok: false, status: "conflito", motivo: "external_ref já usado por outra empresa" };
  }
  if (envio && envio.status === "enviada" && !dados.forcar) {
    return { http: 200, ok: true, status: "enviada", motivo: "já enviada antes", id: envio.id, repetida: true };
  }

  if (!envio) {
    const nomeArquivo = `guia-mei-${dados.cnpj}-${dados.competencia}-${crypto.randomBytes(6).toString("hex")}.pdf`;
    fs.writeFileSync(path.join(UPLOAD_DIR, nomeArquivo), dados.pdf);
    const titulo = `${TIPOS[dados.tipo]} ${competenciaBr(dados.competencia)}`;
    try {
      const { rows: d } = await db.query(
        `INSERT INTO deliverables
           (company_id, category, doc_type, title, competencia, due_date, file_path, file_name,
            source, external_ref, access_token, released_at)
         VALUES ($1,'guia',$2,$3,$4,$5,$6,$7,'central-ecac',$8,$9, now())
         RETURNING id`,
        [empresa.id, dados.tipo, titulo, competenciaBr(dados.competencia), dados.vencimento,
         nomeArquivo, `${titulo.replace(/[\\/]/g, "-")}.pdf`, `central-ecac:${dados.externalRef}`,
         crypto.randomBytes(24).toString("hex")]
      );
      const { rows: n } = await db.query(
        `INSERT INTO guias_mei_envios (external_ref, company_id, deliverable_id, tipo, competencia, vencimento, valor)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [dados.externalRef, empresa.id, d[0].id, dados.tipo, dados.competencia, dados.vencimento, dados.valor]
      );
      envio = n[0];
    } catch (err) {
      fs.rmSync(path.join(UPLOAD_DIR, nomeArquivo), { force: true });
      throw err;
    }
  }

  const r = await tentarEnvio(db, envio);
  const final = await aplicarResultado(db, envio, r);
  return { http: 200, ok: final.status === "enviada" || final.status === "na_fila", id: envio.id, ...final };
}

/** Status das guias (painel do central-ecac). */
async function statusPorRefs(db, refs) {
  const lista = (refs || []).map((r) => String(r)).slice(0, 500);
  if (!lista.length) return [];
  const { rows } = await db.query(
    `SELECT external_ref, status, motivo, tentativas, enviado_em, atualizado_em
       FROM guias_mei_envios WHERE external_ref = ANY($1)`,
    [lista]
  );
  return rows;
}

/** Drena a fila (fora da janela / teto): chamado a cada ciclo do agendador de alertas. */
async function drenarGuiasMei(db) {
  if (!uazapi.configurado() || !podeDrenar(minutosSP())) return { enviados: 0, tentadas: 0 };
  const { rows } = await db.query(
    `SELECT * FROM guias_mei_envios WHERE status='na_fila' ORDER BY criado_em LIMIT 100`
  );
  let enviados = 0;
  for (const envio of rows) {
    const r = await tentarEnvio(db, envio);
    const final = await aplicarResultado(db, envio, r);
    if (final.status === "enviada") enviados += 1;
    if (r.status === "na_fila" && /Teto/.test(r.motivo || "")) break;
  }
  return { enviados, tentadas: rows.length };
}

module.exports = {
  TIPOS, competenciaBr, dataIso, montarCaption, validarPedido,
  vinculo, receberGuia, statusPorRefs, drenarGuiasMei,
};
