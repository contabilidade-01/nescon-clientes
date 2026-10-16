# Plano — Planejador de escalas (fim da 6x1, EC 141/2026)

Data: 16/10/2026, dia da promulgação da EC 141/2026.

Cada cliente monta e testa a própria escala no portal: arrasta turnos e folgas, edita
horários, simula o contingente por dia e vê, na hora, o que fere a emenda ou a CLT.
Segmentos cobertos: construção civil, restaurantes, comércio em geral; escalas 6x1, 5x2,
12x36 e revezamentos personalizados.

## Passos

1. **Motor de regras** — `src/lib/escala/` (este PR). Modelos de escala e validação.
2. **Tela do planejador** — grade por funcionário com arrastar e soltar (`@dnd-kit` já
   instalado), edição de horários e alertas em tempo real.
3. **Simulação de contingente** — pessoas necessárias por dia e faixa, cobertura/déficit,
   comparação escala atual × etapa 1 × etapa 2 em pessoas e custo.
4. **Salvar e exportar** — escalas por empresa, folgas no calendário, PDF/planilha.

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

Feriados entram como parâmetro (`Set` de datas) — a tela usa `feriadosNacionais` de
`api/src/diasBancarios.js` e o cliente pode acrescentar os municipais.
