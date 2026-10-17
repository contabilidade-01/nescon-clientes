# Plano — Planejador de escalas (fim da 6x1, EC 141/2026)

Data: 16/10/2026, dia da promulgação da EC 141/2026.

Cada cliente monta e testa a própria escala no portal: arrasta turnos e folgas, edita
horários, simula o contingente por dia e vê, na hora, o que fere a emenda ou a CLT.
Segmentos cobertos: construção civil, restaurantes, comércio em geral; escalas 6x1, 5x2,
12x36 e revezamentos personalizados.

## Passos

1. **Motor de regras** — `src/lib/escala/` (este PR). Modelos de escala e validação.
2. **Tela do planejador** — `src/components/escala/PlanejadorEscala.tsx`. Grade do mês
   por funcionário, arrastar e soltar (troca de folga/turno), edição de horário por dia,
   vagas simuladas, contagem de pessoas por dia e lista do que ajustar.
   - **Painel** `/admin/escalas` (área `funcionarios`): o escritório simula QUALQUER cliente.
   - **Portal** `/escalas`: ferramenta `escalas`, que **nasce desligada** — o escritório
     liga em Empresas → "Escalas de trabalho" (decisão do Jean em 16/10/2026). Em grupo,
     basta ligar numa empresa (normalmente a matriz).
3. **Simulação de contingente** — `src/lib/escala/contingente.ts` + `PainelContingente.tsx`.
   Demanda de pessoas por dia da semana → quadro mínimo e custo (salário + FGTS 8%) em
   cada fase (44h, 42h, 40h) e na 12x36. A grade marca em vermelho o dia sem cobertura.
4. **Salvar** — `api/src/routes/escalas.js` (`/api/escalas`), tabelas `escala_config`
   (segmento, acordo, bloqueio, feriados municipais, demanda) e `escala_planejamentos`
   (uma escala por empresa e mês). Ao abrir um mês salvo, quem saiu da empresa some e
   quem entrou ganha o modelo padrão. Falta: exportar PDF/planilha e levar folgas ao
   calendário.

### Atividade, cenários e regras travadas (pedido do Jean em 16/10/2026)

- **Atividade antes de simular** (`EscolherAtividade.tsx`): o cliente marca a atividade
  (comércio, restaurante, construção, outro), se tem acordo coletivo e se usa 12x36. Fica
  salvo em `escala_config` (`atividadeDefinida`, `usa12x36`).
- **Cenários** (`src/lib/escala/cenarios.ts` + `PainelCenarios.tsx`): 5x2 com fim de
  semana livre, 5x2 domingo+segunda, 5x2 em rodízio com domingo a cada 2 ou 3 semanas,
  4x3 de 10h (só com acordo), 12x36 em duas turmas e 6x1 (só até 15/12/2026). Cada um
  passa pelo motor; só o que fica sem erro pode ser aplicado. "Outra variação" gira quem
  folga em que dia sem sair da regra.
- **Rígido nas regras**: arrastar, editar dia, trocar modelo ou horário só passa se não
  criar erro novo (`errosNovos`), e não se salva escala com erro. A escala padrão do mês
  já nasce dentro da regra (6x1 até a emenda, 5x2 depois) e os feriados nascem de folga
  (menos na 12x36).
- **Casa fechada** (pedido do Jean em 16/10/2026, restaurantes em 12x36): cenários
  "Segunda a sábado" (folga no domingo + 1 dia escalonado) e "Fecha na segunda" (folga na
  segunda + 1 dia que cai no domingo no mínimo do segmento), modelo `5x2_fechado`. A
  empresa marca os dias em que fecha; cenário que escala gente nesses dias sai da lista.
  O cartão "Escala de hoje" mede a escala atual (ex.: 12x36) com a mesma régua e cada
  cenário mostra a diferença de pessoas por dia.
- **Horário personalizado** por cenário; se passar do limite (semana ou dia), o cartão
  fica vermelho com o motivo e não aplica. A grade tem a coluna "Maior semana", vermelha
  quando passa do limite e âmbar quando é aviso (acordo ou 12x36).
- Com acordo, a média mensal de folgas só é cobrada quando alguma semana do mês fica
  abaixo das 2 folgas: quem cumpre semana a semana não está compensando (fevereiro de 29
  dias cortava uma folga do rodízio).
- **Por funcionário** (pedido do Jean em 17/10/2026, `src/lib/escala/porPessoa.ts` +
  `PainelPorPessoa.tsx`): escolhe uma pessoa, configura só a escala dela e compara, por
  modelo, as variações de folga que cabem na regra (as outras não aparecem), medidas
  contra a equipe parada: média de pessoas por dia da semana, dias abaixo da demanda e
  diferença para a escala atual. Passar o mouse mostra a prévia no calendário da pessoa
  e na visão da equipe; "Usar esta" passa pela mesma trava da grade.

### Bloqueio de jornada diária (decisão do Jean em 16/10/2026)

Configurável por empresa (`src/lib/escala/bloqueio.ts`): "Só avisar", "Bloquear acima
de 10h" (padrão: 8h + 2h extras) ou "Bloquear qualquer hora extra" (acima de 8h). Na
12x36 o teto é o plantão de 12h. Com bloqueio, o planejador recusa a edição, o arraste
ou o horário padrão que passe do teto, e diz por quê.

### Feriados

Nacionais automáticos (`feriados.ts`): os fixos, Consciência Negra e Sexta-feira Santa.
Carnaval e Corpus Christi são ponto facultativo e entram só se a empresa marcar. Os
municipais e estaduais o cliente (ou o escritório) inclui à mão, anuais ou de um ano só.

## Regras da emenda usadas (texto promulgado, DOU de 16/10/2026)

| Vigência | Limite semanal | Repousos/semana |
|---|---|---|
| até 15/12/2026 | 44h | 1 |
| 16/12/2026 (publicação + 2 meses; arts. 6º, I e 10, I) | 42h | 2, um preferencialmente no domingo |
| 16/12/2027 (etapa 1 + 1 ano; art. 6º, II) | 40h | 2 |

- Limite diário de 8h mantido (XIII). Com acordo/convenção (XIII e § 2º): horas pela
  média das semanas do mês; folgas pela média de 2 por semana **no mês-calendário**
  (arredondada para baixo); nunca uma semana inteira sem folga. Até a etapa 2, a
  convenção pode ampliar o dia para distribuir as 42h (art. 7º da EC): 8h24 não é extra.
- Domingo é só **preferencial** (XV): a emenda não fixa mínimo. O mínimo vem da lei
  comum — comércio 1 a cada 3 semanas (Lei 10.101/2000), demais 1 a cada 7.
- 12x36 continua permitida; acima do limite novo vira aviso de renegociação na convenção.
- Hipersuficiente (nível superior e salário ≥ 2,5x o teto do RGPS, art. 8º): fora das
  regras de horas desde a publicação, mas mantém o repouso.
- Prestadoras do poder público têm prazo de 12 meses — **não se aplica à carteira**
  (decisão do Jean em 16/10/2026), por isso o motor não tem esse campo.
- MEI/ME/EPP podem ganhar regra própria por lei complementar ainda não editada.

Todos os números da emenda estão em `src/lib/escala/regras.ts` (`VIGENCIAS`,
`PUBLICACAO_EC`). Conferidos com o texto promulgado (autógrafo da Câmara de 27/05/2026,
aprovado sem mudança pelo Senado) que o Jean anexou em 16/10/2026.

## Regras da CLT que o motor confere

Jornada diária (8h + até 2h extras; 12h na 12x36), intervalo (art. 71; 30min só com
acordo), interjornada de 11h (art. 66), no máximo 6 dias seguidos (art. 67), domingo de
folga a cada 3 semanas no comércio (Lei 10.101/2000) e a cada 7 nos demais, feriado
trabalhado (comércio exige convenção; demais pagam em dobro ou folga compensatória).

Feriados entram no motor como parâmetro (`Set` de datas), montado por `feriadosDaEmpresa`.
