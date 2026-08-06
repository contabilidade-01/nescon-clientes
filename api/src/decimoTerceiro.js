/**
 * Projeção do 13º salário.
 *
 * Função pura, sem banco: recebe os funcionários e devolve o que a empresa vai
 * desembolsar. É o número que o cliente mais pergunta em outubro, e o que o escritório
 * hoje só responde abrindo planilha.
 *
 * ## As regras que o cálculo respeita
 *
 * **Avos por mês trabalhado, com a regra dos 15 dias** (CLT art. 1º da Lei 4.090/62 e
 * Decreto 57.155/65): conta o mês em que o funcionário trabalhou **15 dias ou mais**.
 * Admitido no dia 20 de março não ganha o avo de março; admitido no dia 10, ganha.
 *
 * **Duas parcelas.** A 1ª vai até 30 de novembro e é **metade do bruto, sem desconto
 * nenhum**. A 2ª vai até 20 de dezembro e é o restante **menos INSS e IRRF do
 * empregado** — por isso a 2ª parcela sempre parece menor que a 1ª, e é normal.
 *
 * ## O que NÃO entra, de propósito
 *
 * **INSS patronal não é projetado.** A alíquota depende do regime: empresa do Simples
 * nos anexos I, II, III e V não recolhe a cota patronal sobre a folha; anexo IV recolhe;
 * fora do Simples são 20% mais RAT e terceiros, que variam por CNAE. Chutar 28,8% para
 * todo mundo daria um número com cara de exato e errado para a maioria da carteira —
 * pior que não mostrar.
 *
 * **FGTS entra**, porque são 8% para qualquer empregador de celetista, sem exceção de
 * regime.
 *
 * O desconto de INSS do empregado usa a tabela progressiva e **é estimativa**: a base
 * real considera outras verbas do mês. Serve para dimensionar o caixa, não para gerar
 * guia.
 */

/** Tabela progressiva do INSS do empregado (2026). Atualizar quando o teto mudar. */
const FAIXAS_INSS = [
  { ate: 1518.0, aliquota: 0.075 },
  { ate: 2793.88, aliquota: 0.09 },
  { ate: 4190.83, aliquota: 0.12 },
  { ate: 8157.41, aliquota: 0.14 },
];

/** INSS pela tabela progressiva — cada faixa incide só sobre a parte dela. */
function inssEmpregado(base) {
  if (!base || base <= 0) return 0;
  let devido = 0;
  let anterior = 0;
  for (const f of FAIXAS_INSS) {
    if (base > anterior) {
      devido += (Math.min(base, f.ate) - anterior) * f.aliquota;
      anterior = f.ate;
    }
  }
  return Number(devido.toFixed(2));
}

function diasNoMes(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * Quantos avos o funcionário tem no ano, de 0 a 12.
 *
 * `admissao` em 'YYYY-MM-DD'. Sem data, assume o ano inteiro (12) — é o caso de quem já
 * estava na empresa, que é a maioria, e assumir menos subestimaria a provisão. Erro para
 * baixo numa projeção de caixa é o erro caro.
 */
function avosNoAno(admissao, ano, mesLimite = 12) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(admissao || ""));
  if (!m) return mesLimite;

  const anoAdm = Number(m[1]);
  const mesAdm = Number(m[2]);
  const diaAdm = Number(m[3]);

  if (anoAdm > ano) return 0;
  if (anoAdm < ano) return mesLimite;

  // Admitido neste ano: conta do mês da admissão em diante.
  const diasTrabalhadosNoMes = diasNoMes(ano, mesAdm) - diaAdm + 1;
  const primeiroAvo = diasTrabalhadosNoMes >= 15 ? mesAdm : mesAdm + 1;
  return Math.max(0, mesLimite - primeiroAvo + 1);
}

/**
 * Projeção de um funcionário. `salario` nulo devolve `null` no valor — **não zero**.
 * Zero somaria como "não custa nada" e esconderia gente da provisão.
 */
function projetarFuncionario({ nome, salario, admissao, ano, mesLimite = 12 }) {
  const avos = avosNoAno(admissao, ano, mesLimite);
  if (salario === null || salario === undefined || !Number.isFinite(Number(salario))) {
    return { nome, admissao, avos, bruto: null, sem_salario: true };
  }
  const bruto = Number(((Number(salario) * avos) / 12).toFixed(2));
  const primeira = Number((bruto / 2).toFixed(2));
  const inss = inssEmpregado(bruto);
  const segunda = Number((bruto - primeira - inss).toFixed(2));
  return {
    nome,
    admissao,
    avos,
    bruto,
    primeira_parcela: primeira,
    inss_empregado: inss,
    segunda_parcela: segunda,
    fgts: Number((bruto * 0.08).toFixed(2)),
    sem_salario: false,
  };
}

/**
 * Projeção da empresa inteira.
 *
 * `mesLimite` permite projetar "como está hoje" (ex.: 8 = até agosto) ou o ano fechado
 * (12). O painel mostra o ano fechado, que é o compromisso real de dezembro.
 */
function projetar({ funcionarios = [], ano, mesLimite = 12 } = {}) {
  const linhas = funcionarios.map((f) =>
    projetarFuncionario({
      nome: f.nome ?? f.name,
      salario: f.salario ?? f.salario_base,
      admissao: f.admissao,
      ano,
      mesLimite,
    })
  );

  const comSalario = linhas.filter((l) => !l.sem_salario);
  const soma = (campo) => Number(comSalario.reduce((a, l) => a + (l[campo] || 0), 0).toFixed(2));

  return {
    ano,
    mes_limite: mesLimite,
    funcionarios: linhas.length,
    // Contado à parte para a tela poder avisar que o total está incompleto, em vez de
    // mostrar um número menor sem explicação.
    sem_salario: linhas.filter((l) => l.sem_salario).length,
    bruto: soma("bruto"),
    primeira_parcela: soma("primeira_parcela"),
    segunda_parcela: soma("segunda_parcela"),
    inss_empregado: soma("inss_empregado"),
    fgts: soma("fgts"),
    custo_total: Number((soma("bruto") + soma("fgts")).toFixed(2)),
    linhas,
  };
}

module.exports = { avosNoAno, inssEmpregado, projetarFuncionario, projetar, FAIXAS_INSS };
