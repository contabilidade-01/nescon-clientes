/**
 * Upload de documentos avulsos com identificação automática de CNPJ.
 *
 * O admin arrasta os PDFs → o portal lê o CNPJ → sugere a empresa → o admin confirma.
 * Duas etapas de propósito: analisar não grava nada. Alocar documento do cliente errado
 * é o pior erro possível aqui, então a máquina sugere e a pessoa decide.
 *
 * A leitura do CNPJ é **determinística** (regex sobre o texto do PDF). Só quando ela não
 * acha nada, e só se o escritório tiver ligado a opção, entra o fallback de IA — ver
 * `api/src/pdfIa.js` para o porquê dessa ordem.
 */
const router = require("express").Router();
const fs = require("fs");
const crypto = require("crypto");
const db = require("../db");
const { authMiddleware } = require("../middleware/auth");
const { requireArea } = require("../middleware/adminArea");
const { validateUUID, validateString } = require("../middleware/validate");
const { uploadPdf, resolveUploadPath, removeUploadFile } = require("../uploads");
const { extrairCnpjs, onlyDigits } = require("../pdfCnpj");
const { detectarCnpjComFallback } = require("../pdfCnpjAi");
const pdfIa = require("../pdfIa");
const { cnpjDoEscritorio } = require("../alertasConfig");

function adminOnly(req, res, next) {
  if (!req.isAdmin) return res.status(403).json({ error: "Acesso restrito a administradores" });
  next();
}

// A trava real é esta, aplicada no router inteiro. Antes ficava numa função declarada
// e nunca chamada — qualquer administrador, mesmo sem a área "entregas", subia arquivo.
router.use(authMiddleware);
router.use(adminOnly);
router.use(requireArea("entregas"));

/**
 * Empresa sugerida a partir dos CNPJs achados, **respeitando a ordem de aparição**.
 *
 * `= ANY($1)` não preserva ordem: com dois CNPJs no documento, o Postgres devolveria
 * um qualquer. Aqui a consulta traz todos os candidatos e a escolha é feita em JS, na
 * ordem em que apareceram no PDF — que é a ordem em que o documento fala deles.
 */
// O CNPJ do próprio escritório aparece no rodapé de quase toda guia que ele emite.
// Sem excluir, um documento do cliente seria alocado para a contabilidade. Vem da tela
// de configuração (app_settings), com o ambiente como plano B.
async function empresaSugerida(cnpjs) {
  const doEscritorio = await cnpjDoEscritorio(db);
  const candidatos = cnpjs.filter((c) => c !== doEscritorio);
  if (!candidatos.length) return { empresa: null, candidatas: [] };

  const { rows } = await db.query(
    `SELECT id, name, cnpj, regexp_replace(cnpj, '\\D', '', 'g') AS cnpj_digitos
       FROM companies
      WHERE regexp_replace(cnpj, '\\D', '', 'g') = ANY($1)`,
    [candidatos]
  );
  const porCnpj = new Map(rows.map((r) => [r.cnpj_digitos, r]));
  const candidatas = candidatos.map((c) => porCnpj.get(c)).filter(Boolean);
  return { empresa: candidatas[0] || null, candidatas };
}

/**
 * POST /analisar — lê os PDFs e devolve o que achou. NÃO grava entrega nenhuma.
 * Os arquivos ficam no disco aguardando confirmação; o que ninguém confirmar é varrido
 * depois pela limpeza (ver api/src/uploadsLimpeza.js).
 */
router.post("/analisar", uploadPdf.array("files", 20), async (req, res) => {
  const arquivos = req.files || [];
  if (!arquivos.length) return res.status(400).json({ error: "Nenhum arquivo enviado" });

  const iaLigada = await pdfIa.iaHabilitada(db);
  const resultados = [];

  for (const file of arquivos) {
    const fullPath = resolveUploadPath(file.filename);
    let cnpjs = [];
    let empresa = null;
    let candidatas = [];
    let origem = "nao_encontrado";
    let observacao = null;

    if (fullPath && fs.existsSync(fullPath)) {
      const buffer = fs.readFileSync(fullPath);

      // Cascata de 3 níveis: regex → busca contextual → IA
      const resultado = await detectarCnpjComFallback(buffer, db);
      cnpjs = resultado.cnpjs;
      origem = resultado.origem;
      observacao = resultado.motivo || resultado.aviso || null;

      if (cnpjs.length) {
        const r = await empresaSugerida(cnpjs);
        empresa = r.empresa;
        candidatas = r.candidatas;
      }

      // Fallback legado (pdfIa via Lovable gateway): só quando tudo acima falhou.
      if (!empresa && iaLigada) {
        const porIa = await pdfIa.cnpjPorIa({ pdfBuffer: buffer, fileName: file.originalname });
        if (porIa) {
          const r = await empresaSugerida([porIa.cnpj]);
          if (r.empresa) {
            empresa = r.empresa;
            candidatas = r.candidatas;
            origem = "ia";
            observacao = `Lido por IA (confiança ${porIa.confianca}). Confira antes de confirmar.`;
          }
          if (!cnpjs.includes(porIa.cnpj)) cnpjs = [...cnpjs, porIa.cnpj];
        }
      }
    }

    resultados.push({
      filename: file.originalname,
      storedName: file.filename,
      cnpjs,
      empresa,
      candidatas,
      origem,
      observacao,
    });
  }

  res.json({ ia_ligada: iaLigada, arquivos: resultados });
});

/**
 * POST /confirmar — o admin confirma a alocação e o documento vira entrega visível.
 * `released_at` já nasce preenchido: documento avulso não passa pela retenção do
 * G-Click, foi o próprio escritório que subiu para o cliente ver.
 */
router.post("/confirmar", async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: "items é obrigatório (array)" });
  }

  const gravados = [];
  const erros = [];

  for (const item of items) {
    const { storedName, company_id, title, doc_type, originalName } = item;

    if (!storedName || !validateString(storedName, 1, 300)) {
      erros.push({ storedName, error: "storedName inválido" });
      continue;
    }
    if (!validateUUID(company_id || "")) {
      erros.push({ storedName, error: "company_id inválido" });
      continue;
    }

    const fullPath = resolveUploadPath(storedName);
    if (!fullPath || !fs.existsSync(fullPath)) {
      erros.push({ storedName, error: "Arquivo não encontrado (expirado ou inválido)" });
      continue;
    }

    const { rows: empresa } = await db.query("SELECT id FROM companies WHERE id = $1", [company_id]);
    if (!empresa.length) {
      erros.push({ storedName, error: "Empresa não encontrada" });
      continue;
    }

    const tituloFinal = String(title || originalName || storedName).trim().slice(0, 200);
    const tipoFinal = validateString(doc_type || "", 1, 40) ? doc_type : "AVULSO";
    // `file_name` é o nome que o CLIENTE vê ao baixar. Guardar o nome interno aqui
    // entregaria "1754400000000-guia.pdf" para ele — o resto do sistema grava o
    // original (ver gclick/sync.gravarGuia).
    const nomeVisivel = String(originalName || title || storedName).trim().slice(0, 200);

    try {
      const { rows } = await db.query(
        `INSERT INTO deliverables
           (company_id, category, doc_type, title, file_path, file_name, source, access_token, released_at)
         VALUES ($1, 'avulso', $2, $3, $4, $5, 'upload_manual', $6, now())
         RETURNING id, company_id, category, doc_type, title, file_name, created_at`,
        [
          company_id,
          tipoFinal,
          tituloFinal,
          storedName,
          nomeVisivel,
          crypto.randomBytes(24).toString("hex"),
        ]
      );
      gravados.push(rows[0]);
    } catch (err) {
      console.error("[doc-upload] confirmar:", err.message);
      erros.push({ storedName, error: "Falha ao gravar a entrega" });
    }
  }

  res.json({ gravados, erros });
});

/** POST /descartar — joga fora o que o admin não quis alocar. */
router.post("/descartar", async (req, res) => {
  const { storedNames } = req.body || {};
  if (!Array.isArray(storedNames) || !storedNames.length) {
    return res.status(400).json({ error: "storedNames é obrigatório" });
  }

  let removidos = 0;
  for (const name of storedNames) {
    if (typeof name === "string" && name.length) {
      removeUploadFile(name);
      removidos++;
    }
  }

  res.json({ removidos });
});

/** Estado do fallback de IA — a tela mostra e o dono liga/desliga. */
router.get("/ia", async (_req, res) => {
  res.json(await pdfIa.estado(db));
});

router.put("/ia", async (req, res) => {
  const { habilitada } = req.body || {};
  if (typeof habilitada !== "boolean") {
    return res.status(400).json({ error: "habilitada deve ser booleano" });
  }
  if (habilitada && !pdfIa.configurada()) {
    return res.status(400).json({
      error: "Falta a chave da IA no ambiente (LOVABLE_API_KEY). Ligar agora não teria efeito.",
    });
  }
  try {
    res.json(await pdfIa.definirIaHabilitada(db, habilitada));
  } catch (err) {
    console.error("[doc-upload] ia:", err.message);
    res.status(500).json({ error: "Erro ao salvar a opção" });
  }
});

module.exports = router;
