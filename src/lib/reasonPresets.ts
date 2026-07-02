/**
 * Modelos prontos de motivo para advertência/suspensão (além de falta injustificada).
 * O texto preenche o campo de motivo e pode ser editado/complementado pelo usuário
 * (ex.: acrescentar datas, nomes ou detalhes do ocorrido).
 */
export const REASON_PRESETS: Array<{ label: string; text: string }> = [
  {
    label: "Atrasos recorrentes",
    text: "Atrasos recorrentes e reiterados ao serviço, em descumprimento ao horário de trabalho contratado e ao dever de pontualidade.",
  },
  {
    label: "Má conduta / indisciplina",
    text: "Conduta inadequada no ambiente de trabalho, em desacordo com as normas internas da empresa, caracterizando ato de indisciplina.",
  },
  {
    label: "Briga / agressão",
    text: "Envolvimento em desentendimento com agressões (verbais e/ou físicas) no ambiente de trabalho, conduta incompatível com o dever de urbanidade e de respeito aos colegas.",
  },
  {
    label: "Insubordinação",
    text: "Recusa injustificada ao cumprimento de ordens legítimas do empregador, caracterizando ato de insubordinação.",
  },
];
