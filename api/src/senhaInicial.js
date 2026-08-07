/**
 * Senha inicial de acesso da empresa.
 *
 * A senha inicial era o **próprio CNPJ**. CNPJ é público e listável na Receita, então
 * toda empresa que ainda não tivesse feito o primeiro acesso estava aberta a quem
 * soubesse o número — e saber o número é trivial. As duas camadas que já pusemos (limite
 * de tentativas no login e bloqueio da API até a troca) reduzem o estrago, mas nenhuma
 * resolve a origem: a senha não era secreta.
 *
 * Agora é aleatória. A troca obrigatória no primeiro acesso deixa de ser a única barreira
 * e passa a ser o que devia ser desde o início — redundância.
 *
 * ## O alfabeto é escolhido, não sorteado
 *
 * Sem `0/O`, `1/l/I`, `5/S`, `8/B`: a senha vai ser lida em voz alta ao telefone e
 * digitada à mão. Caractere ambíguo aqui não é detalhe estético — é o cliente ligando
 * para dizer que a senha não funciona.
 *
 * Sem símbolos pelo mesmo motivo. O comprimento compensa: 10 caracteres neste alfabeto
 * de 51 dão cerca de 57 bits, muito além do que o limite de tentativas do login permite
 * tentar em qualquer tempo útil.
 *
 * ## Aleatoriedade
 *
 * `randomInt` do módulo `crypto`, não `Math.random()` — que é previsível e nunca deve
 * gerar credencial. E sem viés de módulo: `randomInt(n)` já distribui uniformemente.
 */
const crypto = require("crypto");

const ALFABETO = "ACDEFGHJKLMNPQRTUVWXYZacdefghijkmnpqrstuvwxyz23467 9".replace(/ /g, "");
const TAMANHO = 10;

/** Uma senha nova. Formatada em dois blocos, que é mais fácil de ditar e conferir. */
function gerarSenhaInicial() {
  let s = "";
  for (let i = 0; i < TAMANHO; i += 1) {
    s += ALFABETO[crypto.randomInt(ALFABETO.length)];
  }
  // "abcde-fghij": o hífen ajuda a leitura e é aceito no login (a senha é comparada
  // como veio, então o cliente digita exatamente o que recebeu).
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

module.exports = { gerarSenhaInicial, ALFABETO, TAMANHO };
