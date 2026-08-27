/** Limita e tipa o JSON da ficha — o front manda o formulário inteiro. */

const STR = (max) => ({ t: "str", max });
const BOOL = { t: "bool" };

const FIELDS = {
  docLivro: BOOL,
  docCtps: BOOL,
  docAso: BOOL,
  docFoto: BOOL,
  docCopias: BOOL,
  docCpf: BOOL,
  docRg: BOOL,
  docComprovante: BOOL,
  docTitulo: BOOL,
  docCertidaoCivil: BOOL,
  docReservistaCopia: BOOL,
  docPis: BOOL,
  sexo: STR(40),
  temFilhos: BOOL,
  filhoDeficiente: BOOL,
  filhoCertidao: BOOL,
  filhoVacina: BOOL,
  filhoEscolaridade: BOOL,
  nome: STR(200),
  endereco: STR(300),
  cidade: STR(120),
  cep: STR(12),
  nacionalidade: STR(80),
  nascimento: STR(10),
  identidade: STR(40),
  identidadeOrgao: STR(40),
  identidadeLocal: STR(200),
  identidadeEmissao: STR(10),
  telefone: STR(30),
  cpf: STR(18),
  titulo: STR(40),
  tituloZona: STR(10),
  tituloSecao: STR(10),
  tituloUf: STR(2),
  reservista: STR(40),
  reservistaCategoria: STR(20),
  reservistaUf: STR(2),
  ctpsNumero: STR(40),
  ctpsSerie: STR(20),
  ctpsUf: STR(2),
  ctpsEmissao: STR(10),
  pis: STR(20),
  pai: STR(200),
  mae: STR(200),
  estadoCivil: STR(40),
  conjuge: STR(200),
  grauInstrucao: STR(120),
  grauCompleto: STR(20),
  corRaca: STR(40),
  primeiroEmprego: STR(20),
  dataAdmissao: STR(10),
  salario: STR(40),
  funcao: STR(120),
  cargaMensal: STR(20),
  cargaSemanal: STR(20),
  diaFolga: STR(80),
  contratoExperiencia: STR(80),
  valeTransporte: STR(10),
  horarioEntrada: STR(20),
  horarioSaida: STR(20),
  intervalo: STR(40),
  jornadaObs: STR(500),
  jornadaPreset: STR(40),
  asoData: STR(10),
};

function clip(val, max) {
  if (val == null) return "";
  return String(val).trim().slice(0, max);
}

function sanitizeDados(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const [key, spec] of Object.entries(FIELDS)) {
    if (spec.t === "bool") {
      out[key] = src[key] === true;
    } else {
      out[key] = clip(src[key], spec.max);
    }
  }
  return out;
}

function funcionarioNome(dados) {
  const n = dados && dados.nome ? String(dados.nome).trim() : "";
  return n || "—";
}

module.exports = { sanitizeDados, funcionarioNome };
