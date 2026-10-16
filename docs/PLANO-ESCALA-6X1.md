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

### Bloqueio de jornada diária (decisão do Jean em 16/10/2026)

Configurável por empresa (`src/lib/escala/bloqueio.ts`): "Só avisar", "Bloquear acima
de 10h" (padrão: 8h + 2h extras) ou "Bloquear qualquer hora extra" (acima de 8h). Na
12x36 o teto é o plantão de 12h. Com bloqueio, o planejador recusa a edição, o arraste
ou o horário padrão que passe do teto, e diz por quê.

### Feriados

Nacionais automáticos (`feriados.ts`): os fixos, Consciência Negra e Sexta-feira Santa.
Carnaval e Corpus Christi são ponto facultativo e entram só se a empresa marcar. Os
municipais e estaduais o cliente (ou o escritório) inclui à mão, anuais ou de um ano só.

## Regras da emenda usadas (fonte: imprensa; conferir com o DOU)

| Vigência | Limite semanal | Repousos/semana |
|---|---|---|
| até 14/12/2026 | 44h | 1 |
| 15/12/2026 (promulgação + 60 dias) | 42h | 2, um preferencialmente no domingo |
| 15/12/2027 (etapa 1 + 12 meses) | 40h | 2 |

- Limite diário de 8h mantido. Acordo/convenção coletiva pode compensar: o motor cobra
  horas e folgas pela média do mês e a semana isolada vira aviso.
- 12x36 continua permitida; acima do limite novo vira aviso de renegociação na convenção.
- Hipersuficiente (nível superior e salário ≥ 2,5x o teto do RGPS): fora das regras de
  horas a partir da etapa 1, mas mantém o repouso.
- Prestadoras do poder público têm prazo de 12 meses — **não se aplica à carteira**
  (decisão do Jean em 16/10/2026), por isso o motor não tem esse campo.
- MEI/ME/EPP podem ganhar regra própria por lei complementar ainda não editada.

Todos os números da emenda estão em `src/lib/escala/regras.ts` (`VIGENCIAS`). Quando o
texto oficial sair, corrige-se só essa tabela.

## Regras da CLT que o motor confere

Jornada diária (8h + até 2h extras; 12h na 12x36), intervalo (art. 71; 30min só com
acordo), interjornada de 11h (art. 66), no máximo 6 dias seguidos (art. 67), domingo de
folga a cada 3 semanas no comércio (Lei 10.101/2000) e a cada 7 nos demais, feriado
trabalhado (comércio exige convenção; demais pagam em dobro ou folga compensatória).

Feriados entram no motor como parâmetro (`Set` de datas), montado por `feriadosDaEmpresa`.
