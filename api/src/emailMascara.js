/**
 * E-mail mascarado para a tela de "esqueci minha senha" — o padrão dos bancos:
 * `joao.silva@gmail.com` → `jo•••••@gm•••.com`.
 *
 * Mostra o suficiente para o cliente reconhecer o próprio e-mail e não o bastante para
 * alguém montar o endereço (LGPD, art. 6º, III — necessidade). A quantidade de pontos é
 * FIXA, para não revelar o tamanho do nome; nome curto mostra só a 1ª letra.
 */
const PONTOS = "•••••";
const PONTOS_DOMINIO = "•••";

function mascararEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  const arroba = e.lastIndexOf("@");
  if (arroba < 1 || arroba === e.length - 1) return null;

  const nome = e.slice(0, arroba);
  const dominio = e.slice(arroba + 1);

  const mostraNome = nome.length <= 4 ? 1 : 2;
  const ponto = dominio.indexOf(".");
  const base = ponto > 0 ? dominio.slice(0, ponto) : dominio;
  const final = ponto > 0 ? dominio.slice(ponto) : "";
  const mostraBase = base.length <= 3 ? 1 : 2;

  return `${nome.slice(0, mostraNome)}${PONTOS}@${base.slice(0, mostraBase)}${PONTOS_DOMINIO}${final}`;
}

module.exports = { mascararEmail };
