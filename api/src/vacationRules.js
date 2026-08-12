/**
 * Regras de férias — decididas em UM lugar só, sem banco, para poderem ser testadas.
 *
 * Duas escolhas de fundo, que explicam o resto do arquivo:
 *
 * 1. **Não recalculamos os dias de direito.** O G-Click já aplica o Art. 130 e manda
 *    `dias_direito` na Programação de Férias (11 faltas → 24 dias, conferido no PDF do
 *    QUEIJEIRO 3). Recalcular seria arriscar discordar do documento oficial que o
 *    cliente tem em mãos. A tabela abaixo serve para outra coisa: dizer **quantas
 *    faltas ainda cabem** antes de cair para a próxima faixa — que é o aviso útil,
 *    porque chega enquanto ainda dá para agir.
 *
 * 2. **Sem salário não há custo.** Devolvemos `null`, não zero: zero afirma que as
 *    férias não custam nada, e é mentira. Branco faz a tela perguntar.
 */

/** Art. 130 da CLT: faltas injustificadas no período aquisitivo × dias de férias. */
const FAIXAS_ART130 = [
  { ate: 5, dias: 30 },
  { ate: 14, dias: 24 },
  { ate: 23, dias: 18 },
  { ate: 32, dias: 12 },
  { ate: Infinity, dias: 0 },
];

/** Janela de aviso: quantos dias antes do limite oficial a férias entra em "a vencer". */
const DIAS_SEGURANCA = 30;

/** FGTS sobre férias. Único encargo considerado — ver docs/PLANO-FERIAS.md §2. */
const ALIQUOTA_FGTS = 0.08;

function faixaDe(faltas) {
  const n = Number(faltas);
  const f = Number.isFinite(n) && n > 0 ? n : 0;
  return FAIXAS_ART130.find((x) => f <= x.ate);
}

/** Dias a que o funcionário teria direito com aquele número de faltas. */
function diasPorFaltas(faltas) {
  return faixaDe(faltas).dias;
}

function faixaLabel(faltas) {
  const f = faixaDe(faltas);
  if (f.ate === 5) return "Até 5 faltas";
  if (f.ate === Infinity) return "Mais de 32 faltas";
  const anterior = FAIXAS_ART130[FAIXAS_ART130.indexOf(f) - 1].ate;
  return `${anterior + 1} a ${f.ate} faltas`;
}

/**
 * O aviso que interessa ao empregador: com 11 faltas, mais 4 e o funcionário perde
 * 6 dias de férias. Devolve `null` quando já não há o que perder (acima de 32).
 */
function faltasParaProximaPerda(faltas) {
  const f = Math.max(0, Number(faltas) || 0);
  const atual = faixaDe(f);
  if (atual.ate === Infinity) return null;
  const proxima = FAIXAS_ART130[FAIXAS_ART130.indexOf(atual) + 1];
  return {
    faltasAtuais: f,
    diasAtuais: atual.dias,
    // A faixa vira na PRÓXIMA falta depois do teto: teto 5 → a 6ª derruba.
    faltasRestantes: atual.ate + 1 - f,
    diasDepois: proxima.dias,
    perde: atual.dias - proxima.dias,
  };
}

/** ISO (AAAA-MM-DD) 30 dias antes do limite oficial. Null se não houver limite. */
function limiteSeguranca(limiteGozo, dias = DIAS_SEGURANCA) {
  const d = paraData(limiteGozo);
  if (!d) return null;
  d.setDate(d.getDate() - dias);
  return isoDe(d);
}

/**
 * Situação de um período, contra a data de hoje. Mesma ideia das licenças: nada é
 * gravado, tudo é calculado na leitura.
 *
 *  - `vencida`  — passou do limite oficial de gozo (risco de dobra, Art. 137)
 *  - `a_vencer` — está dentro dos 30 dias finais (o limite de segurança já passou)
 *  - `ok`       — ainda há folga
 *  - `sem_limite` — a Programação não trouxe data
 */
function situacao(limiteGozo, hoje = new Date(), dias = DIAS_SEGURANCA) {
  const limite = paraData(limiteGozo);
  if (!limite) return "sem_limite";
  const base = soData(hoje);
  if (limite < base) return "vencida";
  const seguranca = paraData(limiteSeguranca(limiteGozo, dias));
  return seguranca && seguranca <= base ? "a_vencer" : "ok";
}

/**
 * Custo das férias: salário proporcional aos dias + 1/3 constitucional + FGTS.
 *
 * O FGTS incide sobre férias **já com o terço** — por isso ele multiplica o subtotal,
 * não só o bruto. Devolve `null` quando não há salário: ver o comentário do topo.
 *
 * **Estagiário é outro cálculo.** O recesso de 30 dias da Lei 11.788/2008 não é férias
 * da CLT: paga-se a bolsa-auxílio proporcional e mais nada. Não há terço constitucional
 * (o adicional é direito do trabalhador celetista) nem FGTS (estágio não gera vínculo
 * empregatício). Somar os dois inflava o custo previsto de quem tem estagiário — e o
 * erro passava despercebido porque o número ficava só um pouco maior, nunca absurdo.
 */
function custoFerias(salarioBase, dias, { estagiario = false } = {}) {
  const salario = Number(salarioBase);
  const d = Number(dias);
  if (!Number.isFinite(salario) || salario <= 0) return null;
  if (!Number.isFinite(d) || d <= 0) return null;

  const bruto = (salario / 30) * d;
  const umTerco = estagiario ? 0 : bruto / 3;
  const fgts = estagiario ? 0 : (bruto + umTerco) * ALIQUOTA_FGTS;
  return {
    bruto: arredondar(bruto),
    umTerco: arredondar(umTerco),
    fgts: arredondar(fgts),
    total: arredondar(bruto + umTerco + fgts),
  };
}

/** Soma dos custos de vários períodos; ignora quem está sem salário. */
function somarCustos(custos) {
  const validos = custos.filter(Boolean);
  return {
    bruto: arredondar(validos.reduce((s, c) => s + c.bruto, 0)),
    umTerco: arredondar(validos.reduce((s, c) => s + c.umTerco, 0)),
    fgts: arredondar(validos.reduce((s, c) => s + c.fgts, 0)),
    total: arredondar(validos.reduce((s, c) => s + c.total, 0)),
    // Quantos ficaram de fora por falta de salário — a tela precisa poder avisar.
    semSalario: custos.length - validos.length,
  };
}

function arredondar(n) {
  return Math.round(n * 100) / 100;
}

/** Aceita "AAAA-MM-DD", Date ou timestamp ISO. Meia-noite local, sem escorregar de dia. */
function paraData(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : soData(valor);
  const iso = String(valor).slice(0, 10);
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function soData(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isoDe(d) {
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

module.exports = {
  FAIXAS_ART130,
  DIAS_SEGURANCA,
  ALIQUOTA_FGTS,
  diasPorFaltas,
  faixaLabel,
  faltasParaProximaPerda,
  limiteSeguranca,
  situacao,
  custoFerias,
  somarCustos,
};
