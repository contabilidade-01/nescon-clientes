/**
 * Prazo da senha TEMPORÁRIA do cliente (a que o escritório manda por WhatsApp).
 *
 * O prazo só vale enquanto a senha ainda é a temporária (`must_change_password`). Depois
 * que o cliente cria a própria senha — pela troca no 1º acesso ou pelo "esqueci minha
 * senha" — não existe mais o que expirar. Antes o login olhava só a data, e o
 * "esqueci minha senha" não limpava a data: o cliente criava senha nova e continuava
 * barrado com "Senha temporária expirada".
 */
const DIAS_SENHA_TEMPORARIA = 30;

function senhaTemporariaExpirada({ mustChangePassword, passwordExpiresAt }, agora = new Date()) {
  if (!mustChangePassword || !passwordExpiresAt) return false;
  const limite = new Date(passwordExpiresAt);
  if (Number.isNaN(limite.getTime())) return false;
  return limite < agora;
}

function novoPrazoSenhaTemporaria(agora = new Date()) {
  return new Date(agora.getTime() + DIAS_SENHA_TEMPORARIA * 24 * 60 * 60 * 1000);
}

module.exports = { DIAS_SENHA_TEMPORARIA, senhaTemporariaExpirada, novoPrazoSenhaTemporaria };
