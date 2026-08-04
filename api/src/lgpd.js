/**
 * Termo de consentimento LGPD mostrado ao cliente no primeiro acesso.
 *
 * O texto vive AQUI e é servido ao front por /api/auth/lgpd-termo — assim o que o
 * cliente leu, o que o admin vê na auditoria e a versão gravada no aceite são sempre
 * o mesmo. Ao alterar o texto, suba a versão: aceites antigos continuam registrados
 * com a versão que estava no ar quando foram dados.
 */
const LGPD_CONSENT_VERSION = "2026-08-v1";

const LGPD_CONSENT_TITLE = "Antes de continuar, precisamos do seu consentimento";

const LGPD_CONSENT_PARAGRAPHS = [
  "Para prestar os serviços de contabilidade e disponibilizar seus documentos neste portal, a Nescon trata dados da sua empresa e dos seus funcionários (CNPJ, nome, CPF, guias, folha e documentos fiscais), conforme a Lei Geral de Proteção de Dados (LGPD – Lei nº 13.709/2018).",
  "Ao concordar, você confirma que autoriza o tratamento desses dados para a execução dos serviços contratados e das obrigações legais; que eles são usados apenas para essa finalidade e não são compartilhados com terceiros sem base legal; e que você pode solicitar informações ou a exclusão a qualquer momento pelos nossos canais de atendimento.",
];

const LGPD_CONSENT_CHECKBOX = "Li e concordo com o tratamento dos meus dados conforme descrito.";

function lgpdTermo() {
  return {
    versao: LGPD_CONSENT_VERSION,
    titulo: LGPD_CONSENT_TITLE,
    paragrafos: LGPD_CONSENT_PARAGRAPHS,
    checkbox: LGPD_CONSENT_CHECKBOX,
  };
}

module.exports = { LGPD_CONSENT_VERSION, lgpdTermo };
