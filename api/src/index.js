require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const db = require("./db");
const { ensurePlatformAdmins } = require("./ensurePlatformAdmins");
const { ensurePasswordResetSchema } = require("./ensurePasswordResetSchema");
const { ensureToolAccessSchema } = require("./ensureToolAccessSchema");
const { ensureDeliverablesSchema } = require("./ensureDeliverablesSchema");
const { ensureLicensesSchema } = require("./ensureLicensesSchema");
const { ensureAdminUsersSchema } = require("./ensureAdminUsersSchema");
const {
  ensureGclickClientsSchema,
  backfillGclickClients,
} = require("./ensureGclickClientsSchema");
const { ensureAppSettings } = require("./appSettings");
const { resolverJwtSecret } = require("./jwtSecret");
const { ensureEmployeePayrollFields } = require("./ensureEmployeePayrollFields");
const { ensureExtratoAutoSchema } = require("./ensureExtratoAutoSchema");
const { ensureVacationSchema } = require("./ensureVacationSchema");
const { ensureEngagementSchema } = require("./ensureEngagementSchema");
const { ensureAlertasSchema } = require("./ensureAlertasSchema");
const { ensurePayrollHistorySchema } = require("./ensurePayrollHistorySchema");
const { ensureCoraSchema } = require("./ensureCoraSchema");
const { ensureDueDateSugestoesSchema } = require("./ensureDueDateSugestoesSchema");
const { ensureChatSchema } = require("./ensureChatSchema");
const { ensureArquivamentoSchema } = require("./ensureArquivamentoSchema");
const { ensureAcessosSchema } = require("./ensureAcessosSchema");
const { ensureCompanyMatriz } = require("./ensureCompanyMatriz");
const { ensureAdmissionSchema } = require("./ensureAdmissionSchema");
const { ensureMonthlyFollowSchema } = require("./ensureMonthlyFollowSchema");
const { ensureWhatsappDpSchema } = require("./ensureWhatsappDpSchema");
const { ensureDpDocsSchema } = require("./ensureDpDocsSchema");

const app = express();
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));

/**
 * Cabeçalhos de segurança.
 *
 * `contentSecurityPolicy: false` porque quem serve o HTML é o nginx, não esta API — a
 * CSP fica lá (nginx/default.conf), onde a página é montada. Ligar aqui não protegeria
 * nada e daria falsa sensação de estar coberto.
 *
 * `crossOriginResourcePolicy` afrouxado para o front poder buscar os PDFs quando API e
 * site estão em domínios diferentes, que é o caso em produção.
 */
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

/**
 * CORS restrito à origem do portal.
 *
 * Era `cors()` sem argumento — qualquer site do mundo podia chamar esta API a partir do
 * navegador de um cliente logado. O dano hoje seria limitado porque o token vive em
 * `localStorage` e outra origem não o lê; mas isso é proteção acidental, não desenhada:
 * no dia em que alguém trocar para cookie, vira falha de verdade.
 *
 * Sem `PUBLIC_APP_URL` definido, mantém o comportamento antigo em vez de derrubar o
 * portal de quem ainda não configurou — mas avisa alto no log.
 */
const origensPermitidas = [process.env.PUBLIC_APP_URL, process.env.CORS_EXTRA_ORIGIN]
  .filter(Boolean)
  .map((o) => o.replace(/\/+$/, ""));

if (!origensPermitidas.length) {
  console.warn(
    "[SEGURANÇA] CORS aberto a qualquer origem: defina PUBLIC_APP_URL para restringir."
  );
}

app.use(
  cors({
    origin(origin, cb) {
      // Sem `Origin` = chamada servidor-a-servidor ou ferramenta local; CORS não se
      // aplica a essas, e recusá-las quebraria a integração com o sistema de guias.
      if (!origin || !origensPermitidas.length) return cb(null, true);
      cb(null, origensPermitidas.includes(origin.replace(/\/+$/, "")));
    },
  })
);

app.use(express.json({ limit: "1mb" }));

// Servir arquivos de upload (anexos do chat, PDFs de entregas).
const { UPLOAD_DIR } = require("./uploads");
app.use("/api/uploads", express.static(path.resolve(UPLOAD_DIR)));

// Nota de segurança: quem está com a senha inicial (= CNPJ, público) é barrado na API
// inteira, não só na tela. A trava vive DENTRO do authMiddleware — ver
// blockUntilPasswordChanged em middleware/auth.js e o porquê de não ser aqui.
// Routes
app.use("/api/auth", require("./routes/auth"));
// Gestão de usuários do painel (só o dono). Antes de /api/admin: rota mais específica.
app.use("/api/admin/usuarios", require("./routes/adminUsers"));
app.use("/api/admin/atendimentos", require("./routes/adminChat"));
const admissionsRoutes = require("./routes/admissions");
app.use("/api/admin/admissoes", admissionsRoutes.adminRouter);
app.use("/api/admin/acompanhamentos", require("./routes/monthlyFollow"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/chat", require("./routes/chat"));
app.use("/api/employees", require("./routes/employees"));
app.use("/api/admissoes", admissionsRoutes.router);
app.use("/api/documents", require("./routes/documents"));
app.use("/api/certificates", require("./routes/certificates"));
app.use("/api/deliverables", require("./routes/deliverables"));
// Licenças (funcionamento, AVCB/CLCB, sanitária) e taxa anual da prefeitura: só admin.
// Clientes vindos do G-Click: espelho, alertas e a decisão do escritório.
app.use("/api/gclick-clientes", require("./routes/gclickClients"));
app.use("/api/ferias", require("./routes/vacations").router);
app.use("/api/folha", require("./routes/folha"));
app.use("/api/licencas", require("./routes/licenses"));
app.use("/api/taxas-anuais", require("./routes/annualTaxes"));
// Ingestão servidor-a-servidor (sistema de guias): auth própria por X-Ingest-Key.
app.use("/api/fiscal", require("./routes/fiscalIngest"));
app.use("/api/alertas", require("./routes/alertas"));
app.use("/api/preferencias", require("./routes/preferencias"));
app.use("/api/doc-upload", require("./routes/documentUpload"));
app.use("/api/mensagens", require("./routes/engagement"));
app.use("/api/portal", require("./routes/portal"));
app.use("/api/whatsapp", require("./routes/whatsappWebhook"));
// Download público (token opaco) dos termos emitidos pelo assistente do WhatsApp.
app.use("/api/dp-docs", require("./routes/dpDocs"));

// Health: sempre HTTP 200 para o healthcheck do Docker / proxy não derrubar o contentor.
// Estado da BD vai no JSON (use database: "down" para diagnosticar login 500).
app.get("/api/health", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "ok", database: "up" });
  } catch (err) {
    console.error("Health DB check:", err.message);
    res.status(200).json({
      status: "ok",
      database: "down",
      message: err.message,
    });
  }
});

const PORT = process.env.PORT || 3001;

async function start() {
  try {
    await ensurePlatformAdmins(db);
    await ensurePasswordResetSchema(db);
    await ensureToolAccessSchema(db);
    await ensureDeliverablesSchema(db);
    await ensureLicensesSchema(db);
    await ensureAdminUsersSchema(db);
    await ensureGclickClientsSchema(db);
    await ensureAppSettings(db);
    // Depois de app_settings existir e ANTES de qualquer token ser assinado: o segredo
    // vem do ambiente ou, na falta dele, da instalação (gerado e guardado). Nunca de
    // um padrão no código.
    const seg = await resolverJwtSecret(db);
    console.log(
      seg.origem === "gerado"
        ? "[auth] segredo dos tokens GERADO nesta subida e guardado na instalação."
        : `[auth] segredo dos tokens: ${seg.origem}.`
    );
    await ensureEmployeePayrollFields(db);
    await ensureExtratoAutoSchema(db);
    await ensureVacationSchema(db);
    await ensureEngagementSchema(db);
    await ensureAlertasSchema(db);
    await ensurePayrollHistorySchema(db);
    await ensureCoraSchema(db);
    await ensureChatSchema(db);
    await ensureArquivamentoSchema(db);
    await ensureDueDateSugestoesSchema(db);
    await ensureAcessosSchema(db);
    await ensureCompanyMatriz(db);
    await ensureAdmissionSchema(db);
    await ensureMonthlyFollowSchema(db);
    await ensureWhatsappDpSchema(db);
    await ensureDpDocsSchema(db);
    // Se há employees sem vínculo, reprocessar extratos imediatamente (não esperar 6h).
    // Roda em background para não travar o arranque.
    setTimeout(async () => {
      try {
        const { rows } = await db.query(
          "SELECT 1 FROM employees WHERE vinculo IS NULL AND active IS TRUE LIMIT 1"
        );
        if (rows.length) {
          console.log("[boot] employees sem vínculo detectados — reprocessando extratos...");
          const extratoAuto = require("./extratoAuto");
          await extratoAuto.processarExtratos(db);
        }
      } catch (e) {
        console.error("[boot] reprocessamento de extratos falhou:", e.message);
      }
    }, 3000).unref();
    // Alerta de vencimento pelo WhatsApp. O agendador sobe sempre, mas só dispara se
    // alguém ligar na tela — ninguém deve começar a mandar mensagem por acidente de
    // deploy, e ligar não deve custar um.
    require("./alertasEnvio").iniciarAgendadorAlertas(db);
    // Varre PDFs que ficaram no volume sem dono (análise abandonada, gravação que
    // falhou). Conservadora: só o que ninguém referencia e já passou do TTL.
    require("./uploadsLimpeza").iniciarLimpezaUploads(db);
    // Backup diario do banco -- o unico dado que nao volta sozinho. So roda se alguem
    // ligar na tela; o padrao e desligado.
    require("./backupAgendador").iniciarAgendadorBackup(db);
    // Primeira carga do espelho de clientes do G-Click. Fora do await: depende de
    // rede e pode demorar; o arranque não espera nem cai se o G-Click estiver fora.
    setTimeout(() => {
      backfillGclickClients(db).catch((e) => console.error("[backfill gclick]", e.message));
    }, 5000).unref();
    // Nota: a antiga limpeza de inativos no boot foi REMOVIDA. Demitido agora é
    // inativado (active=false) e MANTIDO para o admin ver o histórico; some só da
    // empresa. Ver a detecção de demissão na importação por extrato (routes/admin.js).
    // Puxa os documentos do G-Click de tempos em tempos (GCLICK_SYNC_INTERVAL_H).
    require("./gclick/sync").iniciarAgendador();
    // Puxa boletos da Cora de tempos em tempos (CORA_SYNC_INTERVAL_H).
    require("./coraSync").iniciarAgendador();
  } catch (err) {
    console.error("Startup DB tasks:", err.message);
    throw err;
  }
  app.listen(PORT, () => console.log(`API running on port ${PORT}`));
}

start().catch((err) => {
  console.error("API failed to start:", err);
  process.exit(1);
});
