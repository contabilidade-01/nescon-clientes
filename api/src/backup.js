/**
 * Backup diário do banco — o único dado que NÃO volta sozinho.
 *
 * Os PDFs são recuperáveis: quase todos descem do G-Click de novo (ver
 * `arquivosIntegridade.js`). O banco não. Decisões sobre obrigações, consentimentos
 * LGPD, preferências do cliente, dispensas de férias e histórico de envio não existem
 * em nenhum outro lugar.
 *
 * ## Por que o dump é criptografado, sem exceção
 *
 * O arquivo carrega CPF e PIS de funcionários, salários, CNPJ, telefone e e-mail dos
 * clientes, hashes de senha. É base de **dados pessoais de terceiros** — dos clientes da
 * Nescon e dos funcionários deles. Um dump em claro circulando por e-mail ou WhatsApp
 * fica no servidor do provedor, no aparelho e no backup do aparelho; celular perdido
 * viraria vazamento da carteira inteira. O portal pede consentimento LGPD ao cliente na
 * porta de entrada — mandar a base dele em claro pela porta dos fundos seria incoerente.
 *
 * Só a **notificação** vai pelo WhatsApp; o arquivo vai por e-mail, cifrado.
 *
 * ## Por que ele se confere sozinho
 *
 * Backup só descoberto na hora do desastre é fé, não backup. E os modos de falha reais
 * não são "não sei restaurar" — são dump vazio, truncado, gerado contra o banco errado,
 * ou chave perdida. Nenhum deles se resolve depois. Por isso cada execução:
 *
 *  1. descompacta o próprio arquivo (gzip íntegro?);
 *  2. procura os marcadores de um dump de verdade e as tabelas que têm de estar lá;
 *  3. conta as linhas das tabelas principais e manda os números na mensagem.
 *
 * Se um dia chegar "3 empresas" onde chegavam 61, dá para agir antes de precisar.
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const zlib = require("zlib");
const { promisify } = require("util");

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/** Tabelas cuja ausência no dump significa backup inútil. */
const TABELAS_ESPERADAS = ["companies", "deliverables", "employees", "company_obligations"];

/** O que vai contado na mensagem — os números que o escritório reconhece de cabeça. */
const TABELAS_CONTADAS = [
  "companies",
  "deliverables",
  "employees",
  "company_obligations",
  "alert_sends",
];

function senhaDoBackup() {
  return (process.env.BACKUP_SENHA || "").trim();
}

function configurado() {
  return senhaDoBackup().length >= 12;
}

/**
 * Roda `pg_dump` e devolve o SQL. Falha alto: um backup que "quase" deu certo é pior
 * que nenhum, porque cria a sensação de estar coberto.
 */
function gerarDump({ timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      "-h", process.env.DB_HOST || "postgres",
      "-p", String(process.env.DB_PORT || 5432),
      "-U", process.env.DB_USER || "rhapp",
      "-d", process.env.DB_NAME || "rhapp",
      "--no-owner",
      "--no-privileges",
    ];
    const proc = spawn("pg_dump", args, {
      env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || "" },
    });

    const partes = [];
    const erros = [];
    const t = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("pg_dump passou do tempo limite"));
    }, timeoutMs);

    proc.stdout.on("data", (d) => partes.push(d));
    proc.stderr.on("data", (d) => erros.push(d));
    proc.on("error", (e) => {
      clearTimeout(t);
      reject(new Error(`pg_dump não executou: ${e.message}`));
    });
    proc.on("close", (code) => {
      clearTimeout(t);
      if (code !== 0) {
        return reject(new Error(`pg_dump saiu com ${code}: ${Buffer.concat(erros).toString().slice(0, 300)}`));
      }
      resolve(Buffer.concat(partes));
    });
  });
}

/**
 * Confere o dump antes de dar por feito. Devolve `{ ok, problemas[] }`.
 * Recebe o SQL já em texto para não descompactar duas vezes.
 */
function conferirDump(sql) {
  const problemas = [];
  if (sql.length < 10000) problemas.push(`Dump pequeno demais (${sql.length} bytes).`);
  if (!/PostgreSQL database dump/i.test(sql)) problemas.push("Não parece um dump do PostgreSQL.");
  if (!/PostgreSQL database dump complete/i.test(sql)) {
    // O rodapé só existe quando o pg_dump terminou: é o sinal mais direto de truncamento.
    problemas.push("Dump truncado — falta a marca de conclusão.");
  }
  for (const t of TABELAS_ESPERADAS) {
    if (!new RegExp(`CREATE TABLE public\\.${t}\\b`, "i").test(sql)) {
      problemas.push(`Tabela ausente no dump: ${t}.`);
    }
  }
  return { ok: problemas.length === 0, problemas };
}

/** Quantas linhas em cada tabela — os números conferíveis da mensagem. */
async function contarLinhas(db) {
  const out = {};
  for (const t of TABELAS_CONTADAS) {
    try {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${t}`);
      out[t] = rows[0].n;
    } catch {
      out[t] = null; // tabela ainda não existe nesta instalação
    }
  }
  return out;
}

/**
 * AES-256-GCM com chave derivada por scrypt. Formato do arquivo:
 *
 *   "NESCONBK1" | salt(16) | iv(12) | tag(16) | conteúdo cifrado
 *
 * Sem dependência externa e sem gpg instalado no contentor. A decifragem está em
 * `scripts/restaurar-backup.js`, no próprio repositório — deixar o formato documentado
 * só num comentário seria a melhor forma de perder o backup junto com a memória de
 * quem o escreveu.
 */
const MAGIC = Buffer.from("NESCONBK1");

function cifrar(buffer, senha) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const chave = crypto.scryptSync(senha, salt, 32);
  const c = crypto.createCipheriv("aes-256-gcm", chave, iv);
  const dados = Buffer.concat([c.update(buffer), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), dados]);
}

function decifrar(buffer, senha) {
  if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Arquivo não é um backup do portal (assinatura não confere).");
  }
  let p = MAGIC.length;
  const salt = buffer.subarray(p, (p += 16));
  const iv = buffer.subarray(p, (p += 12));
  const tag = buffer.subarray(p, (p += 16));
  const chave = crypto.scryptSync(senha, salt, 32);
  const d = crypto.createDecipheriv("aes-256-gcm", chave, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buffer.subarray(p)), d.final()]);
}

function formatarBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Executa o backup completo: dump, conferência, compressão, cifragem.
 * Devolve o arquivo e o relatório — quem entrega (e-mail, WhatsApp) é outro passo.
 */
async function executarBackup(db) {
  if (!configurado()) {
    return { ok: false, erro: "BACKUP_SENHA ausente ou curta demais (mínimo 12 caracteres)." };
  }

  const inicio = Date.now();
  const sqlBuffer = await gerarDump();
  const sql = sqlBuffer.toString("utf8");

  const conferencia = conferirDump(sql);
  const linhas = await contarLinhas(db);

  const comprimido = await gzip(sqlBuffer, { level: 9 });
  // Descompacta o que acabou de comprimir: pega gzip corrompido ANTES de enviar, que é
  // o momento em que ainda dá para fazer alguma coisa a respeito.
  const conferido = await gunzip(comprimido);
  if (conferido.length !== sqlBuffer.length) {
    conferencia.ok = false;
    conferencia.problemas.push("O arquivo comprimido não devolve o dump original.");
  }

  const cifrado = cifrar(comprimido, senhaDoBackup());
  const dia = new Date().toISOString().slice(0, 10);

  return {
    ok: conferencia.ok,
    problemas: conferencia.problemas,
    nome: `portal-${dia}.sql.gz.enc`,
    arquivo: cifrado,
    bytes_sql: sqlBuffer.length,
    bytes_arquivo: cifrado.length,
    tamanho: formatarBytes(cifrado.length),
    linhas,
    segundos: Math.round((Date.now() - inicio) / 1000),
    dia,
  };
}

/** Resumo curto para o WhatsApp: números conferíveis, sem dado pessoal nenhum. */
function mensagemResumo(r) {
  const linhas = [
    r.ok ? "✅ *Backup do portal concluído*" : "⚠️ *Backup do portal com problema*",
    "",
    `Data: ${r.dia}`,
    `Arquivo: ${r.tamanho} (cifrado, enviado por e-mail)`,
    "",
    "*Conteúdo:*",
  ];
  const rotulos = {
    companies: "empresas",
    deliverables: "entregas",
    employees: "funcionários",
    company_obligations: "obrigações marcadas",
    alert_sends: "alertas enviados",
  };
  for (const [t, n] of Object.entries(r.linhas)) {
    if (n !== null) linhas.push(`• ${n} ${rotulos[t] || t}`);
  }
  if (!r.ok) {
    linhas.push("");
    for (const p of r.problemas) linhas.push(`⚠️ ${p}`);
  }
  linhas.push("");
  linhas.push("_Se estes números caírem de repente, avise antes de precisar restaurar._");
  return linhas.join("\n");
}

module.exports = {
  executarBackup,
  mensagemResumo,
  conferirDump,
  cifrar,
  decifrar,
  configurado,
  formatarBytes,
  MAGIC,
};
