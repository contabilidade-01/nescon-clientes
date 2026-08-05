require("dotenv").config();
const express = require("express");
const cors = require("cors");
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
const { ensureEmployeePayrollFields } = require("./ensureEmployeePayrollFields");
const { ensureExtratoAutoSchema } = require("./ensureExtratoAutoSchema");
const { ensureVacationSchema } = require("./ensureVacationSchema");
const { ensureEngagementSchema } = require("./ensureEngagementSchema");
const { ensureAlertasSchema } = require("./ensureAlertasSchema");

const app = express();
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/auth", require("./routes/auth"));
// Gestão de usuários do painel (só o dono). Antes de /api/admin: rota mais específica.
app.use("/api/admin/usuarios", require("./routes/adminUsers"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/employees", require("./routes/employees"));
app.use("/api/documents", require("./routes/documents"));
app.use("/api/certificates", require("./routes/certificates"));
app.use("/api/deliverables", require("./routes/deliverables"));
// Licenças (funcionamento, AVCB/CLCB, sanitária) e taxa anual da prefeitura: só admin.
// Clientes vindos do G-Click: espelho, alertas e a decisão do escritório.
app.use("/api/gclick-clientes", require("./routes/gclickClients"));
app.use("/api/ferias", require("./routes/vacations").router);
app.use("/api/licencas", require("./routes/licenses"));
app.use("/api/taxas-anuais", require("./routes/annualTaxes"));
// Ingestão servidor-a-servidor (sistema de guias): auth própria por X-Ingest-Key.
app.use("/api/fiscal", require("./routes/fiscalIngest"));
app.use("/api/alertas", require("./routes/alertas"));
app.use("/api/doc-upload", require("./routes/documentUpload"));
app.use("/api/mensagens", require("./routes/engagement"));

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
    await ensureEmployeePayrollFields(db);
    await ensureExtratoAutoSchema(db);
    await ensureVacationSchema(db);
    await ensureEngagementSchema(db);
    await ensureAlertasSchema(db);
    // Alerta de vencimento pelo WhatsApp. Só liga com ALERTAS_ENVIO_ATIVO=true —
    // ninguém deve começar a mandar mensagem para cliente por acidente de deploy.
    require("./alertasEnvio").iniciarAgendadorAlertas(db);
    // Varre PDFs que ficaram no volume sem dono (análise abandonada, gravação que
    // falhou). Conservadora: só o que ninguém referencia e já passou do TTL.
    require("./uploadsLimpeza").iniciarLimpezaUploads(db);
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
