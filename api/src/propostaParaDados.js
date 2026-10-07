/**
 * Um cadastro só para a cadeia proposta → contrato → onboarding.
 *
 * Converte o cliente e as condições da proposta no formato parcial de `contratos.dados`
 * (o mesmo que a tela de contratos e as regras do onboarding leem). Só preenche o que a
 * proposta realmente sabe; o resto fica de fora para o contrato usar seus padrões — nunca
 * se inventa valor. Fonte única: a tela de contratos e o onboarding chamam isto pelo servidor.
 */

const ENQUADRAMENTOS = ["mei", "simples", "presumido", "real"];
const TIPOS = ["servico", "comercio", "industria"];
const COMPLEXIDADES = ["baixa", "media", "alta"];

function texto(v, max = 200) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function numPositivo(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Remove chaves vazias para não sobrescrever, na mesclagem, o que o contrato já tem. */
function semVazios(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}

/**
 * @param dados   `propostas.dados` (PropostaDados)
 * @param totalMensal `propostas.total_mensal` — calculado pelo navegador ao salvar
 * @returns parcial de ContratoDados
 */
function propostaParaDadosContrato(dados, totalMensal) {
  const c = (dados && dados.cliente) || {};
  const cond = (dados && dados.condicoes) || {};
  const enquadramento = ENQUADRAMENTOS.includes(c.enquadramento) ? c.enquadramento : null;
  const incluidos = numPositivo(cond.funcionariosIncluidos) ?? numPositivo(c.funcionarios);

  const out = {
    contratante: semVazios({
      razao: texto(c.nome),
      cnpj: texto(c.cnpj, 30),
      email: texto(c.email),
      telefone: texto(c.telefone, 40),
      repNome: texto(c.contato),
    }),
    objeto: semVazios({
      enquadramento,
      modelo: enquadramento === "mei" ? "mei" : enquadramento ? "completo" : null,
      tipoEmpresa: TIPOS.includes(c.tipoEmpresa) ? c.tipoEmpresa : null,
      complexidade: COMPLEXIDADES.includes(c.complexidade) ? c.complexidade : null,
      funcionariosIncluidos: incluidos,
    }),
    prazos: semVazios({ diasGuias: numPositivo(cond.guiasAntecedenciaDias) }),
    honorarios: semVazios({
      valorMensal: numPositivo(totalMensal),
      vencimentoDia: numPositivo(cond.vencimentoDia),
      valorFuncAdicional: numPositivo(cond.valorFuncionarioExtra),
      meioPagamento: texto(cond.formaPagamento),
    }),
  };
  // Seção vazia sai inteira: mesclar `{}` é inofensivo, mas o JSON fica legível.
  for (const k of Object.keys(out)) if (!Object.keys(out[k]).length) delete out[k];
  return out;
}

/** Mescla parcial sobre base, seção por seção (sem recursão além disso). */
function mesclarParcial(base, extra) {
  const out = { ...(base || {}) };
  for (const [sec, val] of Object.entries(extra || {})) {
    out[sec] = val && typeof val === "object" && !Array.isArray(val) ? { ...(out[sec] || {}), ...val } : val;
  }
  return out;
}

module.exports = { propostaParaDadosContrato, mesclarParcial };
