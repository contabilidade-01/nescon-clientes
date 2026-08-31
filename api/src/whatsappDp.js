/**
 * Assistente de DP no WhatsApp: áudio/texto → termo de ADVERTÊNCIA ou SUSPENSÃO em PDF.
 *
 * Regras que definem este fluxo:
 *  1. Escopo fechado. Só advertência e suspensão. Rescisão, folha, férias, imposto e
 *     qualquer outro tema respondem com o contato do escritório — nunca improvisa.
 *  2. Diz que é IA. Quem está do outro lado precisa saber que não é uma pessoa.
 *  3. Identidade antes de emitir. O telefone precisa bater com empresa cadastrada; se o
 *     número atende a MAIS DE UMA empresa, pergunta qual antes de qualquer coisa. Emitir
 *     documento disciplinar na empresa errada é o pior erro possível aqui.
 *  4. Funcionário vem do cadastro. Lista os funcionários da empresa e confirma o nome —
 *     o CPF sai do cadastro, não do que a pessoa digitou (documento sem CPF certo não vale).
 *  5. Confirmação explícita antes de emitir.
 *
 * Ao confirmar, o documento é gerado no servidor (PDF + DOCX), registrado em
 * `issued_documents` e enviado na conversa. O escritório recebe um aviso do que saiu.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("./db");
const { chamarIaConfigurada } = require("./iaProvider");
const { interpretarMensagem } = require("./whatsappDpIa");
const { enviarTexto, enviarDocumento, configurado } = require("./uazapi");
const { getPublicAppUrl } = require("./mailer");
const { gerarArquivos, CONDUTAS, CONDUTA_ORDEM, condutaDe } = require("./dpDocumento");
const { UPLOAD_DIR } = require("./uploads");

const SESSION_MS = 3 * 60 * 60 * 1000;
const ADMIN_WHATSAPP = (process.env.ADMIN_WHATSAPP || "5511948626605").replace(/\D/g, "");
const MAX_LISTA = 25;
const CNPJ_12X36 = new Set(["52191264000173", "54803962000108"]);

function eh12x36(cnpj) {
  return CNPJ_12X36.has(digits(cnpj));
}

function digits(v) {
  return String(v || "").replace(/\D/g, "");
}

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Assinatura de IA — vai na primeira resposta de cada atendimento. */
const SELO_IA = "🤖 *Assistente virtual (IA) da Nescon* — respondo automaticamente.";

function contatoNescon(comSelo = true) {
  const num = digits(process.env.NESCON_CONTATO_WHATSAPP || process.env.ADMIN_WHATSAPP || "5511948626605");
  const visivel = num.startsWith("55") && num.length >= 12
    ? `(${num.slice(2, 4)}) ${num.slice(4, 9)}-${num.slice(9)}`
    : num;
  const portal = getPublicAppUrl() || "https://app.gestaoempresa.com";
  return (
    (comSelo ? `${SELO_IA}\n\n` : "") +
    `Aqui eu trato *somente* de *advertência* e *suspensão* de funcionário.\n\n` +
    `Para qualquer outro assunto (rescisão, folha, férias, impostos, dúvidas), fale com a *Nescon Contabilidade*:\n` +
    `📱 WhatsApp: ${visivel}\n` +
    `💻 Portal: ${portal}`
  );
}

function classificarPorPalavra(texto) {
  const t = norm(texto);
  if (/\b(advertenc|advertir|advertido)\w*/.test(t) || t.includes("advertencia")) return "advertencia";
  if (/\b(suspens|suspender|suspendido)\w*/.test(t) || t.includes("suspensao")) return "suspensao";
  return "outro";
}

async function classificarTema(texto) {
  const porPalavra = classificarPorPalavra(texto);
  if (porPalavra !== "outro") return porPalavra;
  try {
    const { resposta } = await chamarIaConfigurada(db, {
      timeoutMs: 20000,
      prompt:
        `Classifique o pedido de um cliente de escritório de contabilidade (departamento pessoal).\n` +
        `Texto: """${String(texto).slice(0, 800)}"""\n` +
        `Responda SOMENTE JSON: {"tema":"advertencia"} ou {"tema":"suspensao"} ou {"tema":"outro"}.\n` +
        `advertencia = advertir funcionário.\n` +
        `suspensao = suspender funcionário (dias sem trabalhar por medida disciplinar).\n` +
        `outro = rescisão, demissão, desligamento, folha, férias, atestado, imposto, dúvida geral, cumprimento, áudio ininteligível.`,
    });
    const tema = String(resposta?.tema || "outro").toLowerCase();
    if (tema === "advertencia" || tema === "suspensao") return tema;
  } catch (err) {
    console.warn("[whatsapp-dp] IA de classificação indisponível:", err.message);
  }
  return "outro";
}

/**
 * TODAS as empresas ligadas ao telefone (não só a primeira).
 * Casa pelos últimos 8 dígitos: o cadastro tem número com e sem DDI/9º dígito.
 */
async function empresasDoTelefone(phoneDigits) {
  const d = digits(phoneDigits);
  const chave = d.length >= 11 && d.startsWith("55") ? d.slice(2) : d;
  const sufixo = chave.slice(-8);
  if (sufixo.length < 8) return [];
  const { rows } = await db.query(
    `SELECT id, name, cnpj, escala_12x36 FROM companies
      WHERE COALESCE(arquivada, false) = false
        AND COALESCE(excluida, false) = false
        AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') LIKE $1
      ORDER BY name`,
    [`%${sufixo}`]
  );
  return rows;
}

async function funcionariosDa(companyId) {
  if (!companyId) return [];
  const { rows } = await db.query(
    `SELECT id, name, cpf FROM employees
      WHERE company_id = $1 AND COALESCE(active, true) IS TRUE
      ORDER BY name`,
    [companyId]
  );
  return rows;
}

/**
 * Resolve o que a pessoa escreveu num funcionário do cadastro.
 * Devolve {escolhido} | {opcoes} (ambíguo) | {} (nada). Nunca inventa nome.
 */
function resolverFuncionario(lista, texto) {
  const t = norm(texto);
  if (!t || !lista.length) return {};

  // "3" → terceiro item da lista que ele acabou de ver.
  if (/^\d{1,2}$/.test(t)) {
    const i = parseInt(t, 10) - 1;
    if (i >= 0 && i < lista.length) return { escolhido: lista[i] };
  }

  const exato = lista.filter((e) => norm(e.name) === t);
  if (exato.length === 1) return { escolhido: exato[0] };

  const contem = lista.filter((e) => {
    const nome = norm(e.name);
    return nome.includes(t) || t.includes(nome);
  });
  if (contem.length === 1) return { escolhido: contem[0] };
  if (contem.length > 1) return { opcoes: contem.slice(0, 10) };

  // Último recurso: bate por partes do nome (primeiro nome, sobrenome).
  const porParte = lista.filter((e) =>
    norm(e.name).split(" ").some((p) => p.length > 2 && t.split(" ").includes(p))
  );
  if (porParte.length === 1) return { escolhido: porParte[0] };
  if (porParte.length > 1) return { opcoes: porParte.slice(0, 10) };
  return {};
}

function listar(itens, rotulo = (x) => x.name) {
  return itens.map((x, i) => `${i + 1}. ${rotulo(x)}`).join("\n");
}

/** Aceita "hoje", "amanhã" e dd/mm[/aaaa]. Devolve Date ou null (não inventa data). */
function parseData(texto) {
  const t = norm(texto);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  if (t === "hoje") return hoje;
  if (t === "amanha") {
    const d = new Date(hoje);
    d.setDate(d.getDate() + 1);
    return d;
  }
  const m = t.match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/);
  if (!m) return null;
  const dia = parseInt(m[1], 10);
  const mes = parseInt(m[2], 10) - 1;
  let ano = m[3] ? parseInt(m[3], 10) : hoje.getFullYear();
  if (ano < 100) ano += 2000;
  const d = new Date(ano, mes, dia);
  if (d.getDate() !== dia || d.getMonth() !== mes) return null;
  return d;
}

/**
 * WhatsApp (e algumas transcrições) prefixam o recado: "Jean:\n2". Sem isto o número
 * da lista e o "hoje" não casam.
 */
function extrairResposta(texto) {
  const raw = String(texto || "").trim();
  if (!raw) return "";
  const linhas = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const ultima = linhas[linhas.length - 1] || "";
  if (/^\d{1,2}$/.test(ultima)) return ultima;
  if (parseData(ultima)) return ultima;
  const semRotulo = raw.replace(/^[A-Za-zÀ-ÿ0-9 .'\-]{1,40}:\s*/i, "").trim();
  if (semRotulo && semRotulo !== raw) {
    if (/^\d{1,2}$/.test(semRotulo) || parseData(semRotulo)) return semRotulo;
    const ultimasem = semRotulo.split(/\n+/).map((l) => l.trim()).filter(Boolean).pop() || semRotulo;
    if (/^\d{1,2}$/.test(ultimasem) || parseData(ultimasem)) return ultimasem;
    return semRotulo;
  }
  return raw;
}

function parseDatasLista(texto) {
  const t = String(texto || "").trim();
  const pedacos = t.split(/\s*(?:,|;|\be\b)\s*/i).map((p) => p.trim()).filter(Boolean);
  const datas = [];
  for (const p of pedacos) {
    const d = parseData(p);
    if (d) datas.push(d);
  }
  if (datas.length) return datas;
  const unica = parseData(t);
  if (unica) return [unica];
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const out = [];
  const re = /\b(?:no\s+)?dia\s+(\d{1,2})\b/gi;
  let m;
  while ((m = re.exec(t))) {
    const dia = parseInt(m[1], 10);
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), dia);
    if (d.getDate() === dia) out.push(d);
  }
  return out;
}

function soNumeroLista(texto) {
  return /^\d{1,2}$/.test(String(texto || "").trim());
}

function lerDiasSuspensao(texto) {
  const n = parseInt(String(texto).replace(/\D/g, ""), 10);
  if (n === 1 || n === 2 || n === 3) return n;
  return null;
}

function perguntaDiasSuspensao() {
  return (
    `Quantos *dias* de suspensão?\n\n` +
    `1 — 1 dia\n2 — 2 dias\n3 — 3 dias\n\n` +
    `A CLT (art. 474) permite até *30* dias; acima disso vira rescisão. Por aqui o escritório limita a *1, 2 ou 3*.`
  );
}

function pareceFato(texto) {
  const t = String(texto || "").trim();
  if (t.length < 8) return false;
  if (soNumeroLista(t)) return false;
  if (parseData(t) && t.length < 18) return false;
  if (/^(sim|nao|n|s|hoje|amanha)$/.test(norm(t))) return false;
  return ehFaltaOuAtraso(t) || t.length >= 25;
}

function patchDeSlots({ ia, texto, step }) {
  const patch = {};
  const t = String(texto || "").trim();
  const iaObj = ia && typeof ia === "object" ? ia : {};

  if (iaObj.motivo && String(iaObj.motivo).trim().length >= 3) {
    patch.motivo = String(iaObj.motivo).trim();
  } else if (
    pareceFato(t) &&
    step !== "data" &&
    step !== "plantao" &&
    step !== "conduta"
  ) {
    patch.motivo = t;
  }

  const datas = [];
  const datasIa = Array.isArray(iaObj.datas_falta) ? iaObj.datas_falta : [];
  for (const x of datasIa) {
    const parsed = parseData(String(x));
    if (parsed) datas.push(parsed);
    else datas.push(...parseDatasLista(String(x)));
  }
  if (!datas.length) datas.push(...parseDatasLista(t));
  if (datas.length) patch.datasFatoBR = [...new Set(datas.map(formatBR))].join(", ");

  const permitirDias = !(step === "funcionario" && soNumeroLista(t)) && step !== "conduta";
  const diasDet = lerDiasSuspensao(t);
  const diasIa = Number(iaObj.dias);
  if (permitirDias) {
    if (diasDet) patch.dias = diasDet;
    else if (diasIa === 1 || diasIa === 2 || diasIa === 3) patch.dias = diasIa;
  }

  if (iaObj.data) {
    const dt = parseData(String(iaObj.data));
    if (dt) {
      patch.dataISO = dt.toISOString();
      patch.dataBR = formatBR(dt);
    }
  } else if ((step === "data" || step === "dias" || step === "confirma") && parseData(t) && !pareceFato(t)) {
    const dt = parseData(t);
    patch.dataISO = dt.toISOString();
    patch.dataBR = formatBR(dt);
  }

  const cond = String(iaObj.conduta || "");
  if (cond && CONDUTAS[cond]) patch.conduta = cond;

  if (iaObj.anuncio_trabalha === true || iaObj.anuncio_trabalha === false) {
    patch.anuncioEhPlantao = iaObj.anuncio_trabalha;
  }
  return patch;
}

function ehFaltaOuAtraso(texto) {
  const t = norm(texto);
  return /\bfalta/.test(t) || /\batraso/.test(t) || /\bsaida antecip/.test(t);
}

function addDays(d, n) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() + n);
  return x;
}

/**
 * 12x36 (plantão / folga / plantão / folga). Anúncio num dia de trabalho:
 * trabalha no anúncio, folga no dia seguinte, suspensão no próximo plantão,
 * folga, e só então volta (1 dia de suspensão = 1 plantão, não 1 dia corrido).
 */
function calendarioSuspensao12x36({ anuncio, diasPlantao, anuncioEhPlantao }) {
  const n = Math.min(30, Math.max(1, Number(diasPlantao) || 1));
  const offset = anuncioEhPlantao ? 2 : 1;
  const inicio = addDays(anuncio, offset);
  const fim = addDays(inicio, (n - 1) * 2);
  const retorno = addDays(fim, 2);
  return { inicio, fim, retorno, diasPlantao: n, anuncioEhPlantao: Boolean(anuncioEhPlantao) };
}

function redigirMotivoAdvertencia(d) {
  const base = String(d.motivo || "").trim();
  if (d.datasFatoBR) {
    return (
      `Falta(s) ou atraso(s) injustificado(s) ao serviço na(s) data(s) ${d.datasFatoBR}, ` +
      `em descumprimento ao contrato de trabalho e ao dever de assiduidade. ` +
      `Relato do empregador: ${base.replace(/\.+$/, "")}.`
    );
  }
  if (base.length < 50) {
    return (
      `${base.replace(/\.+$/, "")}. A conduta foi apurada pela empregadora e constitui ` +
      `descumprimento das obrigações do contrato de trabalho.`
    );
  }
  return base;
}

function formatBR(d) {
  const p = (x) => String(x).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

async function garantirCalendario12(phone) {
  const sessao = await getSessao(phone);
  const d = sessao?.dados || {};
  if (!d.escala12 || d.anuncioEhPlantao == null || !d.dataISO || d.suspInicioBR) return;
  const cal = calendarioSuspensao12x36({
    anuncio: new Date(d.dataISO),
    diasPlantao: d.dias,
    anuncioEhPlantao: d.anuncioEhPlantao,
  });
  await saveSessao(phone, {
    dados: {
      suspInicioISO: cal.inicio.toISOString(),
      suspFimISO: cal.fim.toISOString(),
      suspRetornoISO: cal.retorno.toISOString(),
      suspInicioBR: formatBR(cal.inicio),
      suspFimBR: formatBR(cal.fim),
      suspRetornoBR: formatBR(cal.retorno),
    },
  });
}

/** Só pergunta o que ainda não veio na conversa (nem na IA). */
async function perguntarProximo(phone) {
  await garantirCalendario12(phone);
  const sessao = await getSessao(phone);
  const d = sessao.dados || {};
  const tema = sessao.tema;

  if (!d.funcionario) {
    await saveSessao(phone, { step: "funcionario" });
    const lista = await funcionariosDa(sessao.company_id);
    const titulo = tema === "advertencia" ? "*advertência*" : "*suspensão*";
    if (!lista.length) {
      return `Vamos emitir a ${titulo}.\n\nDigite o *nome completo* do funcionário.`;
    }
    const mostra = lista.slice(0, MAX_LISTA);
    return (
      `Qual o *funcionário*? Responda o *número* ou o nome:\n\n${listar(mostra)}` +
      (lista.length > MAX_LISTA ? `\n\n(+${lista.length - MAX_LISTA} — se não estiver na lista, digite o nome)` : "")
    );
  }

  if (tema === "suspensao" && !d.dias) {
    await saveSessao(phone, { step: "dias" });
    return `Funcionário: *${d.funcionario}*.\n\n` + perguntaDiasSuspensao();
  }

  if (tema === "suspensao" && !d.dataISO) {
    await saveSessao(phone, { step: "data" });
    return perguntaDataSuspensao(d.escala12 === true);
  }

  if (tema === "suspensao" && d.escala12 === true && d.anuncioEhPlantao == null) {
    await saveSessao(phone, { step: "plantao" });
    return (
      `Data do anúncio: *${d.dataBR}*.\n\n` +
      `Na 12x36: se ele *trabalha* nesse dia, folga no seguinte, a suspensão começa no *próximo plantão*, ` +
      `depois vem folga, e só então ele volta.\n\n` +
      `Nesse dia do anúncio o funcionário *trabalha* (está de plantão)? *SIM* ou *NÃO*.`
    );
  }

  if (!String(d.motivo || "").trim()) {
    await saveSessao(phone, { step: tema === "advertencia" ? "motivo" : "motivo_sus" });
    return tema === "advertencia"
      ? `Funcionário: *${d.funcionario}*.\n\nQual o *motivo* da advertência? (ex.: faltas, atrasos, má conduta)`
      : "Qual o *motivo* da suspensão?";
  }

  if (ehFaltaOuAtraso(d.motivo) && !d.datasFatoBR && tema === "advertencia") {
    await saveSessao(phone, { step: "data_fato" });
    return (
      "Qual a *data da falta* (o dia em que o funcionário não compareceu ou atrasou)?\n" +
      "Pode informar mais de uma: 28/08/2026, 29/08/2026"
    );
  }

  if (!d.conduta && ehFaltaOuAtraso(d.motivo)) {
    await saveSessao(phone, { dados: { conduta: "faltas" } });
    return perguntarProximo(phone);
  }

  if (!d.conduta) {
    await saveSessao(phone, { step: "conduta" });
    return perguntaConduta();
  }

  if (tema === "advertencia" && !d.dataISO) {
    await saveSessao(phone, { step: "data" });
    return (
      "Qual a *data do termo* — o dia em que o documento será assinado, em geral *hoje*?\n" +
      (d.datasFatoBR ? "(Isto *não* é a data da falta; a falta já foi registrada.)" : "")
    );
  }

  await saveSessao(phone, { step: "confirma" });
  const fresh = await getSessao(phone);
  let extra12 = "";
  const f = fresh.dados || {};
  if (tema === "suspensao" && f.escala12 && f.suspInicioBR) {
    extra12 =
      `Na *12x36*, ${f.dias} dia(s) de suspensão não são dias corridos.\n\n` +
      `• Dia do anúncio (${f.dataBR}): ${f.anuncioEhPlantao ? "trabalha" : "folga"}\n` +
      (f.anuncioEhPlantao ? `• Dia seguinte: folga\n` : "") +
      `• Suspensão (plantão em que não trabalha): ${f.suspInicioBR}` +
      (f.suspInicioBR !== f.suspFimBR ? ` a ${f.suspFimBR}` : "") +
      `\n• Folga seguinte e retorno ao trabalho: ${f.suspRetornoBR}\n\n`;
  }
  return extra12 + resumoConfirmacao(f, tema);
}

async function tentarPreencherDaMensagem(phone, texto) {
  const sessao = await getSessao(phone);
  if (!sessao) return null;
  const lista = await funcionariosDa(sessao.company_id);
  let ia = {};
  try {
    ia = await interpretarMensagem(db, { texto, sessao, funcionarios: lista });
  } catch (_) {
    ia = {};
  }
  const slots = patchDeSlots({ ia, texto, step: sessao.step });
  if (Object.keys(slots).length) await saveSessao(phone, { dados: slots });

  const atual = await getSessao(phone);
  if (!atual.dados?.funcionario) {
    const chave = ia.funcionario_numero
      ? String(ia.funcionario_numero)
      : ia.funcionario_nome || texto;
    const r = resolverFuncionario(lista, chave);
    if (r.escolhido) {
      await saveSessao(phone, {
        dados: { funcionario: r.escolhido.name, cpf: r.escolhido.cpf || null, employeeId: r.escolhido.id },
      });
    }
  }
  const s2 = await getSessao(phone);
  if (s2?.dados?.funcionario) return perguntarProximo(phone);
  return null;
}

// --------------------------------------------------------------------------
// Sessão
// --------------------------------------------------------------------------
async function getSessao(phone) {
  const { rows } = await db.query("SELECT * FROM whatsapp_dp_sessions WHERE phone = $1", [phone]);
  return rows[0] || null;
}

async function saveSessao(phone, patch) {
  const cur = (await getSessao(phone)) || { phone, company_id: null, tema: null, step: "idle", dados: {} };
  const dados = patch.replaceDados ? patch.dados || {} : { ...(cur.dados || {}), ...(patch.dados || {}) };
  const next = { ...cur, ...patch, dados };
  await db.query(
    `INSERT INTO whatsapp_dp_sessions (phone, company_id, tema, step, dados, updated_at)
     VALUES ($1,$2,$3,$4,$5::jsonb, now())
     ON CONFLICT (phone) DO UPDATE SET
       company_id = EXCLUDED.company_id, tema = EXCLUDED.tema, step = EXCLUDED.step,
       dados = EXCLUDED.dados, updated_at = now()`,
    [phone, next.company_id, next.tema, next.step, JSON.stringify(next.dados || {})]
  );
}

async function limpar(phone) {
  await db.query("DELETE FROM whatsapp_dp_sessions WHERE phone = $1", [phone]);
}

function sessaoViva(row) {
  if (!row) return false;
  return Date.now() - new Date(row.updated_at).getTime() < SESSION_MS;
}

function ehCancelar(texto) {
  const t = norm(texto);
  return /^(cancelar|cancela|parar|sair|menu)$/.test(t) || t.includes("comecar de novo");
}

function ehSimEmitir(texto) {
  return /^(sim|s|confirmo|ok|pode|isso|certo)$/.test(norm(texto));
}

/** "não" sozinho cancela; "não está correto, o motivo é..." é correção. */
function ehCancelarEmissao(texto) {
  return /^(nao|n|cancelar|nao confirmo)$/.test(norm(texto));
}

function temCorrecao(ia, texto) {
  const iaObj = ia && typeof ia === "object" ? ia : {};
  if (iaObj.motivo || iaObj.dias || iaObj.data || iaObj.funcionario_nome || iaObj.funcionario_numero) return true;
  if (iaObj.conduta || iaObj.anuncio_trabalha === true || iaObj.anuncio_trabalha === false) return true;
  if (Array.isArray(iaObj.datas_falta) && iaObj.datas_falta.length) return true;
  if (pareceFato(texto)) return true;
  if (parseDatasLista(texto).length) return true;
  if (parseData(texto)) return true;
  const nrm = norm(texto);
  if (/\b(2|3|dois|tres|duas)\s*dias?\b/.test(nrm) || /\b1\s*dia\b/.test(nrm)) return true;
  return false;
}

async function avisarEscritorio(resumo) {
  if (!configurado() || !ADMIN_WHATSAPP) return;
  await enviarTexto({ numero: ADMIN_WHATSAPP, texto: resumo, delayMs: 400 }).catch(() => {});
}

// --------------------------------------------------------------------------
// Emissão
// --------------------------------------------------------------------------
function gravar(buffer, nome) {
  const seguro = String(nome).replace(/[^a-zA-Z0-9._-]/g, "_");
  const arquivo = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${seguro}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, arquivo), buffer);
  return arquivo;
}

/**
 * Gera PDF+DOCX, registra a emissão e devolve as URLs públicas.
 * O token é o que permite baixar sem login pelo link do WhatsApp.
 */
async function emitirDocumento({ phone, sessao }) {
  const d = sessao.dados || {};
  const { rows: emp } = await db.query(
    "SELECT id, name, cnpj, escala_12x36 FROM companies WHERE id = $1",
    [sessao.company_id]
  );
  const empresa = emp[0];
  const ehSuspensao = sessao.tema === "suspensao";
  const data = new Date(d.dataISO);
  const motivoDoc = ehSuspensao ? d.motivo : redigirMotivoAdvertencia(d);

  const { pdf, docx, nomeBase } = await gerarArquivos({
    tipo: sessao.tema,
    employeeName: d.funcionario,
    cpf: d.cpf,
    companyName: empresa.name,
    cnpj: empresa.cnpj,
    data: d.suspInicioISO ? new Date(d.suspInicioISO) : data,
    suspensionDays: d.dias,
    motivo: motivoDoc,
    conduta: d.conduta,
    calendario12x36: d.escala12
      ? {
          anuncio: data,
          inicio: new Date(d.suspInicioISO),
          fim: new Date(d.suspFimISO),
          retorno: new Date(d.suspRetornoISO),
          diasPlantao: d.dias,
        }
      : null,
  });

  const arqPdf = gravar(pdf, `${nomeBase}.pdf`);
  const arqDocx = gravar(docx, `${nomeBase}.docx`);
  const token = crypto.randomBytes(24).toString("hex");

  const inicioDoc = d.suspInicioISO ? new Date(d.suspInicioISO) : data;
  const retorno = ehSuspensao
    ? d.suspRetornoISO
      ? new Date(d.suspRetornoISO)
      : new Date(inicioDoc.getTime() + (Number(d.dias) || 1) * 86400000)
    : null;
  await db.query(
    `INSERT INTO issued_documents
       (document_type, employee_name, employee_cpf, company_name, company_cnpj, company_id,
        start_date, suspension_days, return_date, description, file_pdf, file_docx, access_token, origem)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'whatsapp')`,
    [
      ehSuspensao ? "suspension" : "warning",
      d.funcionario,
      d.cpf || "",
      empresa.name,
      empresa.cnpj,
      empresa.id,
      inicioDoc,
      ehSuspensao ? Number(d.dias) || 1 : null,
      retorno,
      motivoDoc || d.motivo || null,
      arqPdf,
      arqDocx,
      token,
    ]
  );

  const base = getPublicAppUrl() || "https://app.gestaoempresa.com";
  return {
    empresa,
    urlPdf: `${base}/api/dp-docs/${token}/pdf`,
    urlDocx: `${base}/api/dp-docs/${token}/docx`,
    nomeBase,
  };
}

async function concluir(phone, sessao) {
  const d = sessao.dados || {};
  const tipo = sessao.tema === "advertencia" ? "Advertência" : "Suspensão";

  let doc;
  try {
    doc = await emitirDocumento({ phone, sessao });
  } catch (err) {
    console.error("[whatsapp-dp] emissão:", err.message);
    await avisarEscritorio(
      `⚠️ Falha ao emitir ${tipo} pelo WhatsApp\nCliente: ${phone}\nFuncionário: ${d.funcionario}\nErro: ${err.message}`
    );
    await limpar(phone);
    return (
      `Não consegui gerar o documento agora. Já avisei o escritório, que vai emitir manualmente.\n\n` +
      contatoNescon(false)
    );
  }

  await avisarEscritorio(
    `📋 ${tipo} emitida pelo assistente (IA)\n` +
      `Empresa: ${doc.empresa.name} (${doc.empresa.cnpj})\n` +
      `Funcionário: ${d.funcionario}${d.cpf ? ` — CPF ${d.cpf}` : ""}\n` +
      (sessao.tema === "suspensao" ? `Dias (plantão${d.escala12 ? " 12x36" : ""}): ${d.dias}\n` : "") +
      (d.datasFatoBR ? `Data do fato: ${d.datasFatoBR}\n` : "") +
      `Data do termo: ${d.dataBR}\n` +
      `Motivo: ${d.motivo}\n` +
      `Enquadramento: ${condutaDe(d.conduta).rotulo}\n` +
      `WhatsApp: ${phone}\n` +
      `PDF: ${doc.urlPdf}`
  );

  // Anexa o PDF na conversa; o DOCX vai como link (via editável, uso do escritório).
  if (configurado()) {
    await enviarDocumento({
      numero: phone,
      fileUrl: doc.urlPdf,
      docName: `${doc.nomeBase}.pdf`,
      caption: `${tipo} — ${d.funcionario}`,
      delayMs: 800,
    }).catch((e) => console.error("[whatsapp-dp] anexo:", e.message));
  }

  await limpar(phone);
  return (
    `✅ *${tipo} emitida!* O PDF acabou de ser enviado aqui.\n\n` +
    `• Funcionário: ${d.funcionario}\n` +
    (d.dias ? `• Dias: ${d.dias}\n` : "") +
    `• Data: ${d.dataBR}\n\n` +
    `📝 Imprima em *2 vias*. Se o funcionário se recusar a assinar, use os campos de *testemunhas* no rodapé.\n` +
    `📄 Versão editável (Word): ${doc.urlDocx}\n\n` +
    `Precisa de outro assunto? ${contatoNescon(false)}`
  );
}

// --------------------------------------------------------------------------
// Máquina de estados
// --------------------------------------------------------------------------

/** Depois de saber a empresa: lista funcionários e pede o nome. */
async function pedirFuncionario(phone, tema, empresa) {
  const lista = await funcionariosDa(empresa.id);
  await saveSessao(phone, {
    company_id: empresa.id,
    tema,
    step: "funcionario",
    dados: { escala12: eh12x36(empresa.cnpj) },
    replaceDados: true,
  });
  const titulo = tema === "advertencia" ? "*advertência*" : "*suspensão*";
  if (!lista.length) {
    return (
      `Empresa: *${empresa.name}*.\nVamos emitir a ${titulo}.\n\n` +
      `Não encontrei funcionários cadastrados nesta empresa. Digite o *nome completo* do funcionário.`
    );
  }
  const mostra = lista.slice(0, MAX_LISTA);
  return (
    `Empresa: *${empresa.name}*.\nVamos emitir a ${titulo}.\n\n` +
    `Qual o *funcionário*? Responda o *número* ou o nome:\n\n${listar(mostra)}` +
    (lista.length > MAX_LISTA ? `\n\n(+${lista.length - MAX_LISTA} — se não estiver na lista, digite o nome)` : "")
  );
}

async function seguirFluxo(phone, sessao, texto) {
  const t = extrairResposta(texto);
  let step = sessao.step;
  const d0 = sessao.dados || {};

  if (step === "empresa") {
    const opcoes = d0.opcoesEmpresa || [];
    let escolhida = null;
    if (/^\d{1,2}$/.test(t)) {
      escolhida = opcoes[parseInt(t, 10) - 1] || null;
    }
    if (!escolhida) {
      const n = norm(t);
      const hits = opcoes.filter((e) => norm(e.name).includes(n) || digits(e.cnpj).includes(digits(t)));
      if (hits.length === 1) escolhida = hits[0];
    }
    if (!escolhida) {
      return `Não identifiquei. Responda com o *número* da empresa:\n\n${listar(opcoes, (e) => `${e.name} — ${e.cnpj}`)}`;
    }
    const intro = await pedirFuncionario(phone, sessao.tema, escolhida);
    const extra = await tentarPreencherDaMensagem(phone, t);
    return extra || intro;
  }

  if (step === "confirma") {
    if (ehSimEmitir(t)) {
      const fresh = await getSessao(phone);
      return concluir(phone, fresh);
    }
    if (ehCancelarEmissao(t)) {
      await limpar(phone);
      return "Cancelado, nada foi emitido.\n\n" + contatoNescon(false);
    }

    let ia = {};
    try {
      const listaIa = await funcionariosDa(sessao.company_id);
      ia = await interpretarMensagem(db, { texto: t, sessao, funcionarios: listaIa });
    } catch (_) {
      ia = {};
    }

    const querCorrigir = temCorrecao(ia, t) || /errado|incorreto|corrige|corrigir|muda|altera|nao esta|nao e isso|nao foi/.test(norm(t));

    if (ia.confirmar === true && !temCorrecao(ia, t)) {
      const fresh = await getSessao(phone);
      return concluir(phone, fresh);
    }
    if (ia.cancelar === true && !querCorrigir) {
      await limpar(phone);
      return "Cancelado, nada foi emitido.\n\n" + contatoNescon(false);
    }

    const slots = patchDeSlots({ ia, texto: t, step: "confirma" });
    if (ia.funcionario_nome || ia.funcionario_numero) {
      const lista = await funcionariosDa(sessao.company_id);
      const chave = ia.funcionario_numero ? String(ia.funcionario_numero) : ia.funcionario_nome;
      const r = resolverFuncionario(lista, chave);
      if (r.escolhido) {
        slots.funcionario = r.escolhido.name;
        slots.cpf = r.escolhido.cpf || null;
        slots.employeeId = r.escolhido.id;
      } else if (r.opcoes) {
        await saveSessao(phone, { step: "funcionario", dados: { ultimaLista: r.opcoes.map((x) => x.id) } });
        return `Encontrei mais de um. Qual deles? Responda o *número*:\n\n${listar(r.opcoes)}`;
      }
    }
    if (slots.dataISO || slots.dias) {
      slots.suspInicioISO = null;
      slots.suspFimISO = null;
      slots.suspRetornoISO = null;
      slots.suspInicioBR = null;
      slots.suspFimBR = null;
      slots.suspRetornoBR = null;
    }
    if (slots.dataISO) slots.anuncioEhPlantao = null;

    if (Object.keys(slots).length) {
      await saveSessao(phone, { dados: slots });
      return "Atualizei com o que você falou. Confira de novo:\n\n" + (await perguntarProximo(phone));
    }

    return (
      "O que preciso corrigir? Pode mandar *áudio* ou texto, por exemplo: *o motivo é falta no dia 28*, *são 2 dias*, *o funcionário é o João*.\n\n" +
      "Se estiver certo, *SIM* para emitir. Para desistir, *cancelar*."
    );
  }

  if (step === "escala") {
    const empresa = (await db.query("SELECT cnpj FROM companies WHERE id = $1", [sessao.company_id])).rows[0];
    await saveSessao(phone, { dados: { escala12: eh12x36(empresa?.cnpj) }, step: "data" });
    sessao = await getSessao(phone);
    step = "data";
  }

  let ia = {};
  try {
    const listaIa = await funcionariosDa(sessao.company_id);
    ia = await interpretarMensagem(db, { texto: t, sessao, funcionarios: listaIa });
  } catch (_) {
    ia = {};
  }
  const slots = patchDeSlots({ ia, texto: t, step });
  if (Object.keys(slots).length) await saveSessao(phone, { dados: slots });
  sessao = await getSessao(phone);
  const d = sessao.dados || {};
  step = sessao.step;

  if (step === "funcionario") {
    const lista = await funcionariosDa(sessao.company_id);
    const chave = soNumeroLista(t) ? t : ia.funcionario_numero ? String(ia.funcionario_numero) : ia.funcionario_nome || t;
    const r = resolverFuncionario(lista, chave);

    if (r.opcoes) {
      await saveSessao(phone, { dados: { ultimaLista: r.opcoes.map((x) => x.id) } });
      return `Encontrei mais de um. Qual deles? Responda o *número*:\n\n${listar(r.opcoes)}`;
    }
    if (!r.escolhido) {
      if (!lista.length) {
        await saveSessao(phone, { dados: { funcionario: t, cpf: null } });
        return perguntarProximo(phone);
      }
      const mostra = lista.slice(0, MAX_LISTA);
      return `Não achei "${t}" no cadastro. Responda o *número* da lista:\n\n${listar(mostra)}`;
    }

    await saveSessao(phone, {
      dados: { funcionario: r.escolhido.name, cpf: r.escolhido.cpf || null, employeeId: r.escolhido.id },
    });
    return perguntarProximo(phone);
  }

  if (step === "dias") {
    if (!d.dias) {
      const n = lerDiasSuspensao(t);
      if (!n) return "Informe *1, 2 ou 3* dias.\n\n" + perguntaDiasSuspensao();
      await saveSessao(phone, { dados: { dias: n } });
    }
    return perguntarProximo(phone);
  }

  if (step === "plantao") {
    if (d.anuncioEhPlantao == null) {
      const nrm = norm(t);
      let anuncioEhPlantao = null;
      if (/^(sim|s|trabalha|plantao|plantão)$/.test(nrm)) anuncioEhPlantao = true;
      else if (/^(nao|n|folga)$/.test(nrm)) anuncioEhPlantao = false;
      if (anuncioEhPlantao === null) {
        return "No dia do anúncio o funcionário *trabalha* (plantão)? *SIM* ou *NÃO* (está de folga).";
      }
      await saveSessao(phone, { dados: { anuncioEhPlantao } });
    }
    return perguntarProximo(phone);
  }

  if (step === "motivo" || step === "motivo_sus") {
    if (!String(d.motivo || "").trim()) {
      if (t.length < 3) return "Descreva o *motivo* com um pouco mais de detalhe — ele vai no documento.";
      await saveSessao(phone, { dados: { motivo: t } });
    }
    return perguntarProximo(phone);
  }

  if (step === "data_fato") {
    if (!d.datasFatoBR) {
      const datas = parseDatasLista(t);
      if (!datas.length) {
        return "Não entendi a data da falta. Use *dd/mm/aaaa*, *hoje*, ou várias separadas por vírgula.";
      }
      await saveSessao(phone, { dados: { datasFatoBR: datas.map(formatBR).join(", ") } });
    }
    return perguntarProximo(phone);
  }

  if (step === "conduta") {
    if (!d.conduta) {
      const i = parseInt(t.replace(/\D/g, ""), 10) - 1;
      const chave = CONDUTA_ORDEM[i];
      if (!chave) return perguntaConduta("Responda com o *número* da opção:");
      await saveSessao(phone, { dados: { conduta: chave } });
    }
    return perguntarProximo(phone);
  }

  if (step === "data") {
    if (!d.dataISO) {
      const data = parseData(t);
      if (!data) return "Não entendi a data. Use *dd/mm/aaaa* (ex.: 28/08/2026), *hoje* ou *amanhã*.";
      await saveSessao(phone, { dados: { dataISO: data.toISOString(), dataBR: formatBR(data) } });
    }
    return perguntarProximo(phone);
  }

  await limpar(phone);
  return contatoNescon();
}

/**
 * Pergunta a natureza da conduta. É o que define a alínea do art. 482 citada no termo —
 * quem enquadra é o cliente, não a IA (alínea errada é pior do que alínea nenhuma).
 */
function perguntaDataSuspensao(escala12) {
  if (escala12) {
    return (
      "Qual a *data do anúncio* da suspensão (em geral *hoje*)?\n" +
      "Na 12x36 isso não é o primeiro dia suspenso: ele ainda trabalha no anúncio, folga no dia seguinte, " +
      "e a suspensão começa no próximo plantão."
    );
  }
  return "Qual a *data de início* da suspensão (dias corridos)? Ex.: 28/08/2026, *hoje* ou *amanhã*.";
}

function perguntaConduta(cabecalho) {
  const opcoes = CONDUTA_ORDEM.map((k, i) => `${i + 1}. ${CONDUTAS[k].rotulo}`).join("\n");
  return (
    `${cabecalho || "Qual a *natureza* da conduta? (define o enquadramento legal no termo)"}\n\n${opcoes}`
  );
}

function resumoConfirmacao(d, tema) {
  const ehSus = tema === "suspensao";
  const cond = condutaDe(d.conduta);
  return (
    `Confira antes de eu emitir:\n\n` +
    `• Documento: *${ehSus ? "Suspensão" : "Advertência"}*\n` +
    `• Funcionário: *${d.funcionario}*\n` +
    (d.cpf ? `• CPF: ${d.cpf}\n` : "• CPF: não cadastrado\n") +
    (ehSus ? `• Dias${d.escala12 ? " de plantão (12x36)" : ""}: ${d.dias}\n` : "") +
    (d.datasFatoBR ? `• Data da falta: ${d.datasFatoBR}\n` : "") +
    `• Data do termo${ehSus ? "/anúncio" : ""}: ${d.dataBR}\n` +
    (d.suspInicioBR
      ? `• Período suspenso: ${d.suspInicioBR}${d.suspFimBR && d.suspFimBR !== d.suspInicioBR ? ` a ${d.suspFimBR}` : ""}\n• Retorno: ${d.suspRetornoBR}\n`
      : "") +
    `• Motivo: ${d.motivo}\n` +
    `• Enquadramento: ${cond.rotulo}${cond.alinea ? ` (art. 482, "${cond.alinea}")` : ""}\n\n` +
    `Responda *SIM* para emitir ou *cancelar* para desistir.\n` +
    `Se algo estiver errado, diga o que mudar (áudio ou texto) — eu atualizo o resumo.`
  );
}

/** Processa uma mensagem já convertida em texto. */
async function processarTexto({ phone, texto }) {
  const raw = extrairResposta(texto);
  if (!raw) {
    return `${SELO_IA}\n\nNão consegui entender. Envie o áudio de novo ou escreva *advertência* ou *suspensão*.`;
  }

  let sessao = await getSessao(phone);
  if (sessao && !sessaoViva(sessao)) {
    await limpar(phone);
    sessao = null;
  }

  if (sessao && sessao.step && sessao.step !== "idle") {
    if (ehCancelar(raw)) {
      await limpar(phone);
      return "Fluxo cancelado.\n\n" + contatoNescon(false);
    }
    return seguirFluxo(phone, sessao, raw);
  }

  const tema = await classificarTema(raw);
  if (tema === "outro") return contatoNescon();

  // Identidade: sem empresa cadastrada neste número, não emite nada.
  const empresas = await empresasDoTelefone(phone);
  if (!empresas.length) {
    return (
      `${SELO_IA}\n\n` +
      `Não encontrei nenhuma empresa cadastrada para este número de WhatsApp, então não posso emitir o documento por aqui.\n\n` +
      contatoNescon(false)
    );
  }

  if (empresas.length > 1) {
    await saveSessao(phone, {
      company_id: null,
      tema,
      step: "empresa",
      dados: { opcoesEmpresa: empresas.map((e) => ({ id: e.id, name: e.name, cnpj: e.cnpj, escala_12x36: e.escala_12x36 })) },
      replaceDados: true,
    });
    return (
      `${SELO_IA}\n\n` +
      `Este número está ligado a *${empresas.length} empresas*. Para qual delas é a ${tema === "advertencia" ? "advertência" : "suspensão"}?\n\n` +
      `Responda o *número*:\n\n${listar(empresas, (e) => `${e.name} — ${e.cnpj}`)}`
    );
  }

  const intro = await pedirFuncionario(phone, tema, empresas[0]);
  const extra = await tentarPreencherDaMensagem(phone, raw);
  return `${SELO_IA}\n\n` + (extra || intro);
}

module.exports = {
  processarTexto,
  contatoNescon,
  // exportados para teste
  resolverFuncionario,
  parseData,
  parseDatasLista,
  lerDiasSuspensao,
  extrairResposta,
  calendarioSuspensao12x36,
  eh12x36,
  ehSimEmitir,
  ehCancelarEmissao,
  temCorrecao,
  classificarPorPalavra,
  empresasDoTelefone,
};
