/**
 * Advertência e suspensão por LINK AVULSO (sem login) — regras puras, sem banco.
 *
 * A tela pública (/avulso/advertencia e /avulso/suspensao) deixa o cliente digitar o
 * CNPJ, achar a empresa no cadastro e gerar o termo com o mesmo modelo do portal. O
 * funcionário, as datas, os dias e o retorno são digitados à mão: o link não lê a lista
 * de funcionários nem o histórico da empresa (nada de dado pessoal sai do servidor).
 *
 * Proteção mínima (o link é público):
 *  - só empresa cadastrada, ativa e com a ferramenta (advertência/suspensão) ligada;
 *  - a consulta do CNPJ devolve só nome e escala, nunca e-mail, telefone ou funcionários;
 *  - limite de tentativas por IP (rota);
 *  - cada emissão fica no histórico com origem 'link_avulso' + IP e avisa o escritório.
 */
const { validateCNPJ, validateDate } = require("./middleware/validate");
const { mergeToolAccess } = require("./companyTools");

const TIPOS = { advertencia: "warning", suspensao: "suspension", warning: "warning", suspension: "suspension" };

function digitos(v) {
  return String(v || "").replace(/\D/g, "");
}

/** Ferramentas do link avulso liberadas para a empresa (mesmas chaves do portal). */
function ferramentasDaEmpresa(toolAccessBruto) {
  const ta = mergeToolAccess(toolAccessBruto);
  return { advertencia: Boolean(ta.warning), suspensao: Boolean(ta.suspension) };
}

function texto(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * Corpo da emissão → dados normalizados, ou { erro }.
 * Datas chegam como 'AAAA-MM-DD' (o front formata no fuso local, igual ao portal).
 */
function validarEmissao(body) {
  const b = body && typeof body === "object" ? body : {};
  const tipo = TIPOS[String(b.tipo || "")];
  if (!tipo) return { erro: "Tipo de documento inválido." };

  const cnpj = digitos(b.cnpj);
  if (!validateCNPJ(cnpj)) return { erro: "CNPJ inválido." };

  const funcionario = texto(b.funcionario, 200);
  if (funcionario.length < 3) return { erro: "Informe o nome do funcionário." };

  const cpf = digitos(b.cpf);
  if (cpf && cpf.length !== 11) return { erro: "CPF do funcionário inválido (11 dígitos) ou deixe em branco." };

  const data = String(b.data || "");
  if (!data || !validateDate(data)) {
    return { erro: tipo === "suspension" ? "Informe a data de início da suspensão." : "Informe a data da advertência." };
  }

  const motivo = texto(b.motivo, 2000);
  if (motivo.length < 3) return { erro: "Escolha ou descreva o motivo." };

  const out = { tipo, cnpj, funcionario, cpf, data, motivo, dias: null, retorno: null };

  if (tipo === "suspension") {
    const dias = parseInt(String(b.dias), 10);
    if (!Number.isFinite(dias) || dias < 1 || dias > 30) {
      return { erro: "Dias de suspensão: de 1 a 30 (art. 474 da CLT)." };
    }
    const retorno = String(b.retorno || "");
    if (!retorno || !validateDate(retorno)) return { erro: "Informe a data de retorno ao trabalho." };
    if (retorno <= data) return { erro: "A data de retorno precisa ser depois do início da suspensão." };
    out.dias = dias;
    out.retorno = retorno;
  }
  return out;
}

module.exports = { validarEmissao, ferramentasDaEmpresa, digitos, TIPOS };
