/**
 * Envio de documentos por link avulso (sem login) — regras puras, sem banco.
 *
 * A página /enviar é pública: qualquer pessoa que saiba um CNPJ consegue mandar arquivo.
 * Por isso o desenho é defensivo (ver routes/envioAvulso.js para a parte de rede):
 *
 * - O arquivo só é aceito se o CONTEÚDO bater com a extensão (assinatura binária), não
 *   pelo nome nem pelo Content-Type, que o navegador de quem envia controla.
 * - Lista fechada de formatos. Fora: executáveis, scripts, HTML/SVG (rodariam no navegador
 *   de quem abrir), Office antigo (.doc/.xls, que carregam macro) e Office com macro.
 * - ZIP e Office novo (que também são ZIP) têm a lista interna conferida: barra executável,
 *   script, macro (vbaProject.bin) e compactado dentro de compactado.
 * - O nome original nunca vira nome em disco: o disco recebe um UUID. O nome original só é
 *   guardado (limpo) para o escritório reconhecer o arquivo ao baixar.
 */

const TIPOS = [
  { chave: "extrato", rotulo: "Extrato bancário", setor: "contabil" },
  { chave: "notas", rotulo: "Notas fiscais (PDF ou XML)", setor: "fiscal" },
  { chave: "folha", rotulo: "Folha de ponto / horas / faltas", setor: "dp" },
  { chave: "atestado", rotulo: "Atestado médico", setor: "dp" },
  { chave: "funcionario", rotulo: "Documentos de funcionário (admissão, rescisão)", setor: "dp" },
  { chave: "comprovante", rotulo: "Comprovante de pagamento / boleto", setor: "financeiro" },
  { chave: "contrato", rotulo: "Contrato / alteração / documento da empresa", setor: "societario" },
  { chave: "outros", rotulo: "Outros", setor: "geral" },
];

const MAX_ARQUIVOS = 10;
/** Por arquivo. Foto de celular passa folgada; PDF escaneado grande também. */
const MAX_BYTES_ARQUIVO = 10 * 1024 * 1024;
/** Por envio. Acompanha `client_max_body_size` da rota em nginx/default.conf. */
const MAX_BYTES_ENVIO = 20 * 1024 * 1024;

/** Extensões aceitas → família do conteúdo que precisa aparecer na assinatura. */
const EXTENSOES = {
  pdf: "pdf",
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
  heic: "heif",
  heif: "heif",
  xlsx: "ooxml",
  docx: "ooxml",
  zip: "zip",
  xml: "xml",
  ofx: "texto",
  csv: "texto",
  txt: "texto",
};

const ACCEPT_HTML = Object.keys(EXTENSOES)
  .map((e) => `.${e}`)
  .join(",");

/** Nomes proibidos dentro de um ZIP (ou de um .docx/.xlsx). */
const PERIGOSO_NO_ZIP =
  /\.(exe|com|bat|cmd|scr|pif|msi|msp|dll|cpl|sys|lnk|url|hta|js|jse|vbs|vbe|wsf|wsh|ps1|psm1|sh|jar|reg|inf|iso|img|vhd|vhdx|apk|app|dmg|html?|svg|xlsm|xltm|docm|dotm|pptm|xlam|zip|rar|7z|gz|tar|cab|arj)$/i;

function digitos(v) {
  return String(v ?? "").replace(/\D/g, "");
}

function limparTexto(v, max) {
  return String(v ?? "")
    // Sem caracteres de controle (exceto quebra de linha) — vai para e-mail e WhatsApp.
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, max);
}

/** Valida o formulário (sem os arquivos). Devolve { erro } ou os campos limpos. */
function validarCampos(body) {
  const b = body && typeof body === "object" ? body : {};
  const cnpj = digitos(b.cnpj);
  if (cnpj.length !== 14) return { erro: "CNPJ inválido." };
  const tipo = TIPOS.find((t) => t.chave === String(b.tipo || ""));
  if (!tipo) return { erro: "Escolha o tipo de documento." };
  return {
    cnpj,
    tipo: tipo.chave,
    observacao: limparTexto(b.observacao, 1000),
    remetente: limparTexto(b.remetente, 120),
  };
}

function extensao(nome) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(String(nome || ""));
  return m ? m[1].toLowerCase() : "";
}

/** Nome para exibir/baixar: só o nome-base, sem caminho, sem caracteres estranhos. */
function nomeExibicao(nome) {
  const base = String(nome || "arquivo").split(/[\\/]/).pop();
  const limpo = base
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} ._()-]/gu, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(-150);
  return limpo || "arquivo";
}

function comeca(buf, bytes, offset = 0) {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (buf[offset + i] !== bytes[i]) return false;
  return true;
}

function ascii(buf, inicio, fim) {
  return buf.subarray(inicio, Math.min(fim, buf.length)).toString("latin1");
}

/**
 * Nomes dos arquivos dentro de um ZIP, lidos do diretório central (o fim do arquivo).
 * Devolve null se o ZIP estiver malformado — e malformado é recusado.
 */
function nomesNoZip(buf) {
  // Fim do diretório central: assinatura 0x06054b50, nos últimos 64 KB + 22 bytes.
  const limite = Math.max(0, buf.length - 0xffff - 22);
  let eocd = -1;
  for (let i = buf.length - 22; i >= limite; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || p === 0xffffffff) return null; // ZIP64: não aceitamos.
  if (total > 5000) return null;
  const nomes = [];
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const lenNome = buf.readUInt16LE(p + 28);
    const lenExtra = buf.readUInt16LE(p + 30);
    const lenComent = buf.readUInt16LE(p + 32);
    if (p + 46 + lenNome > buf.length) return null;
    nomes.push(buf.subarray(p + 46, p + 46 + lenNome).toString("utf8"));
    p += 46 + lenNome + lenExtra + lenComent;
  }
  return nomes;
}

function zipSeguro(buf) {
  if (!comeca(buf, [0x50, 0x4b, 0x03, 0x04])) return false;
  const nomes = nomesNoZip(buf);
  if (!nomes) return false;
  return !nomes.some((n) => PERIGOSO_NO_ZIP.test(n) || /vbaProject\.bin$/i.test(n) || n.includes(".."));
}

function textoSeguro(buf) {
  if (buf.includes(0)) return false; // binário disfarçado
  if (comeca(buf, [0x4d, 0x5a])) return false; // "MZ" = executável Windows
  const inicio = ascii(buf, 0, 512).replace(/^﻿|^\xEF\xBB\xBF/, "").trimStart().toLowerCase();
  // Página HTML/script renomeada para .txt/.csv não entra.
  return !/^<(!doctype|html|script|svg)/.test(inicio);
}

const CONFERE = {
  pdf: (b) => ascii(b, 0, 1024).includes("%PDF-"),
  jpeg: (b) => comeca(b, [0xff, 0xd8, 0xff]),
  png: (b) => comeca(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  webp: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  heif: (b) => ascii(b, 4, 8) === "ftyp" && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(ascii(b, 8, 12)),
  ooxml: zipSeguro,
  zip: zipSeguro,
  xml: (b) => {
    if (!textoSeguro(b)) return false;
    const inicio = ascii(b, 0, 64).replace(/^\xEF\xBB\xBF/, "").trimStart();
    return inicio.startsWith("<");
  },
  texto: textoSeguro,
};

/**
 * Confere um arquivo recebido. `file` = { originalname, size, buffer } (multer em memória).
 * Devolve { ext, nome } ou { erro }.
 */
function conferirArquivo(file) {
  const nome = nomeExibicao(file?.originalname);
  const ext = extensao(nome);
  const familia = EXTENSOES[ext];
  if (!familia) return { erro: `"${nome}": formato não aceito.` };
  const buf = file?.buffer;
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { erro: `"${nome}": arquivo vazio.` };
  if (buf.length > MAX_BYTES_ARQUIVO) return { erro: `"${nome}": maior que 10 MB.` };
  if (!CONFERE[familia](buf)) return { erro: `"${nome}": o conteúdo não confere com o tipo do arquivo.` };
  return { ext, nome };
}

/** Protocolo curto para a pessoa citar ao falar com o escritório (ex.: "EV-7K3M9Q"). */
function gerarProtocolo(randomBytes) {
  const alfabeto = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(6);
  let s = "";
  for (let i = 0; i < 6; i++) s += alfabeto[bytes[i] % alfabeto.length];
  return `EV-${s}`;
}

function rotuloTipo(chave) {
  return TIPOS.find((t) => t.chave === chave)?.rotulo || chave;
}

module.exports = {
  TIPOS,
  MAX_ARQUIVOS,
  MAX_BYTES_ARQUIVO,
  MAX_BYTES_ENVIO,
  ACCEPT_HTML,
  validarCampos,
  conferirArquivo,
  nomeExibicao,
  nomesNoZip,
  gerarProtocolo,
  rotuloTipo,
  digitos,
};
