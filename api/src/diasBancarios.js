/**
 * Calendário de dias bancários e dias úteis trabalhistas.
 *
 * Todo alerta de vencimento nasce aqui: se este arquivo erra um feriado, o cliente
 * recebe "vence amanhã" no dia errado — que é pior do que não avisar. Por isso duas
 * decisões deliberadas:
 *
 * 1. **Datas são strings 'YYYY-MM-DD', nunca `Date` local.** `new Date('2026-08-20')`
 *    é meia-noite UTC e, no fuso do Brasil, imprime dia 19. O resto do repositório já
 *    ordena vencimento por texto pelo mesmo motivo (ver routes/deliverables.js).
 *    Internamente a aritmética usa `Date.UTC`, que não desloca.
 *
 * 2. **"Dia bancário" e "dia útil trabalhista" são coisas diferentes** e o repositório
 *    precisa das duas:
 *      - dia bancário: seg a sex, sem feriado nacional. É o que vale para pagar guia.
 *      - dia útil trabalhista: seg a **sábado**, sem feriado. É o que vale para contar
 *        o 5º dia útil do salário (CLT art. 459 §1º). Contar salário com régua bancária
 *        antecipa o prazo indevidamente e faz o escritório cobrar o cliente cedo demais.
 *
 * Só feriados NACIONAIS entram. Feriado municipal/estadual fecha banco na praça, mas a
 * carteira tem cliente em mais de um município e um calendário municipal errado é pior
 * que nenhum: o alerta é sempre na véspera, então um feriado local não avisado apenas
 * adianta a leitura do cliente em um dia — nunca atrasa o pagamento.
 */

/** Domingo de Páscoa (algoritmo de Gauss/Meeus). Base dos feriados móveis. */
function pascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(ano, mes - 1, dia);
}

const DIA = 86400000;

/** 'YYYY-MM-DD' -> timestamp UTC. Devolve NaN se o formato não for esse. */
function paraUTC(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return NaN;
  const [, a, mes, d] = m;
  const t = Date.UTC(Number(a), Number(mes) - 1, Number(d));
  // Rejeita data inexistente (31/02 viraria 03/03).
  const dt = new Date(t);
  if (dt.getUTCMonth() !== Number(mes) - 1 || dt.getUTCDate() !== Number(d)) return NaN;
  return t;
}

/** timestamp UTC -> 'YYYY-MM-DD'. */
function paraISO(t) {
  return new Date(t).toISOString().slice(0, 10);
}

function iso(ano, mes, dia) {
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * Feriados nacionais do ano, como Set de 'YYYY-MM-DD'.
 *
 * Consciência Negra (20/11) só entra a partir de 2024 — virou feriado nacional pela
 * Lei 14.759/2023. Antes disso era municipal em parte do país, e marcar retroativo
 * bagunçaria qualquer conferência de data histórica.
 */
function feriadosNacionais(ano) {
  const fixos = [
    [1, 1], // Confraternização Universal
    [4, 21], // Tiradentes
    [5, 1], // Dia do Trabalho
    [9, 7], // Independência
    [10, 12], // Nossa Senhora Aparecida
    [11, 2], // Finados
    [11, 15], // Proclamação da República
    [12, 25], // Natal
  ];
  if (ano >= 2024) fixos.push([11, 20]); // Consciência Negra (Lei 14.759/2023)

  const set = new Set(fixos.map(([m, d]) => iso(ano, m, d)));

  const p = pascoa(ano);
  set.add(paraISO(p - 48 * DIA)); // segunda de Carnaval
  set.add(paraISO(p - 47 * DIA)); // terça de Carnaval
  set.add(paraISO(p - 2 * DIA)); // Sexta-feira Santa
  set.add(paraISO(p + 60 * DIA)); // Corpus Christi

  return set;
}

const cacheFeriados = new Map();
function feriadosDoAno(ano) {
  if (!cacheFeriados.has(ano)) cacheFeriados.set(ano, feriadosNacionais(ano));
  return cacheFeriados.get(ano);
}

function ehFeriadoNacional(data) {
  const t = paraUTC(data);
  if (Number.isNaN(t)) return false;
  return feriadosDoAno(new Date(t).getUTCFullYear()).has(data);
}

/**
 * Sem expediente bancário em 24 e 31 de dezembro (decisão da Febraban, valendo há anos).
 * Fica isolado porque é convenção, não lei: se mudar, muda só aqui.
 */
function semExpedienteBancario(data) {
  return /-12-(24|31)$/.test(data);
}

/** Seg a sex, sem feriado nacional, fora dos dias sem expediente. */
function ehDiaBancario(data) {
  const t = paraUTC(data);
  if (Number.isNaN(t)) return false;
  const dow = new Date(t).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  if (ehFeriadoNacional(data)) return false;
  if (semExpedienteBancario(data)) return false;
  return true;
}

/** Seg a SÁBADO, sem feriado nacional. Régua do 5º dia útil do salário. */
function ehDiaUtilTrabalhista(data) {
  const t = paraUTC(data);
  if (Number.isNaN(t)) return false;
  if (new Date(t).getUTCDay() === 0) return false;
  return !ehFeriadoNacional(data);
}

function anda(data, passo, limite = 40) {
  let t = paraUTC(data);
  if (Number.isNaN(t)) return null;
  for (let i = 0; i < limite; i += 1) {
    t += passo * DIA;
    const d = paraISO(t);
    if (ehDiaBancario(d)) return d;
  }
  return null;
}

/** Primeiro dia bancário a partir de `data` (inclusive). */
function proximoDiaBancario(data) {
  if (ehDiaBancario(data)) return data;
  return anda(data, 1);
}

/** Último dia bancário até `data` (inclusive). */
function diaBancarioAnterior(data) {
  if (ehDiaBancario(data)) return data;
  return anda(data, -1);
}

/** Quantos dias tem o mês. */
function diasNoMes(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** Último dia bancário do mês — vencimento de carnê-leão, quotas do IR e parcelamentos. */
function ultimoDiaBancarioDoMes(ano, mes) {
  return diaBancarioAnterior(iso(ano, mes, diasNoMes(ano, mes)));
}

/**
 * N-ésimo dia útil trabalhista do mês (sábado conta). `n` padrão 5 = salário.
 * Devolve também se caiu em sábado: nesse caso a CLT obriga pagamento em dinheiro,
 * porque não há compensação bancária — o cliente precisa ser avisado disso.
 */
function nEsimoDiaUtilTrabalhista(ano, mes, n = 5) {
  const total = diasNoMes(ano, mes);
  let contados = 0;
  for (let d = 1; d <= total; d += 1) {
    const data = iso(ano, mes, d);
    if (!ehDiaUtilTrabalhista(data)) continue;
    contados += 1;
    if (contados === n) {
      return { data, sabado: new Date(paraUTC(data)).getUTCDay() === 6 };
    }
  }
  return null;
}

/** N-ésimo dia bancário do mês (seg–sex, sem feriado nacional / 24 e 31/12). */
function nEsimoDiaBancario(ano, mes, n = 5) {
  const total = diasNoMes(ano, mes);
  let contados = 0;
  for (let d = 1; d <= total; d += 1) {
    const data = iso(ano, mes, d);
    if (!ehDiaBancario(data)) continue;
    contados += 1;
    if (contados === n) return data;
  }
  return null;
}

/** Soma dias corridos a uma data ISO. Usado para "o que vence daqui a N dias". */
function somarDias(data, dias) {
  const t = paraUTC(data);
  if (Number.isNaN(t)) return null;
  return paraISO(t + dias * DIA);
}

/** Hoje no fuso de São Paulo, como 'YYYY-MM-DD'. O servidor roda em UTC. */
function hojeSP(agora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

/**
 * Minutos desde a meia-noite no fuso de São Paulo (0..1439). O servidor roda em UTC;
 * usar isto em vez de `getHours()` evita agendar no fuso errado. Ex.: 07:50 = 470.
 */
function minutosSP(agora = new Date()) {
  const hhmm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(agora);
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** 'YYYY-MM-DD' -> 'DD/MM' para texto de mensagem. */
function ddmm(data) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(data || ""));
  return m ? `${m[3]}/${m[2]}` : String(data || "");
}

module.exports = {
  pascoa,
  feriadosNacionais,
  ehFeriadoNacional,
  ehDiaBancario,
  ehDiaUtilTrabalhista,
  proximoDiaBancario,
  diaBancarioAnterior,
  ultimoDiaBancarioDoMes,
  nEsimoDiaUtilTrabalhista,
  nEsimoDiaBancario,
  diasNoMes,
  somarDias,
  hojeSP,
  minutosSP,
  ddmm,
};
