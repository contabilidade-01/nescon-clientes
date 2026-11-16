# Plano — Jornadas de 44h para 42h e 40h (EC 141/2026)

Pedido do Jean em 13/11/2026 e 16/11/2026. O planejador de escalas (ver
`PLANO-ESCALA-6X1.md`) já tinha as regras; este plano leva a transição para o resto do portal.

## PR 1 — Jornada no cadastro, admissão por data e conferência da lista

- **Jornada no cadastro** (`employees`: `carga_semanal`, `escala`, `folga`,
  `horario_entrada`, `horario_saida`, `hipersuficiente`, `jornada_atualizada_em`;
  `api/src/ensureJornadaSchema.js`, validação em `api/src/employeeJornada.js`).
- **Situação por data** (`src/lib/jornadaFuncionario.ts`): ok, atenção (42h em 5 dias
  pede acordo; 12x36 pede convenção), fora (acima do limite; 6x1 depois de 16/12/2026) e
  a próxima etapa em que a jornada deixa de valer.
- **Ficha de admissão**: modelo 42h (210h/mês), 44h e 6x1 só para admissão até
  15/12/2026, 42h só até 15/12/2027, e aviso quando a carga passa do limite da data.
- **Conferência pelo cliente** (tela Funcionários): resumo (ativos, sem jornada, fora
  da regra, precisam mudar até a próxima etapa) e botão "A lista está certa", que grava
  `companies.funcionarios_conferidos_em`.
- **Poderes do cliente**: adicionar, editar e excluir valem para quem tem qualquer
  ferramenta que usa a lista (antes editar/excluir exigiam a ferramenta Funcionários).
  Excluir vale para qualquer cadastro, menos quem tem atestado (aí é Inativar).
  Gerentes continuam só com leitura.

## Parte 2 — Prontidão, aditivo e circular

- **Prontidão 42h / 40h** (`/admin/jornadas`, área funcionários; `GET /api/escalas/prontidao`):
  por cliente com funcionário, quantos ficam fora da regra e em atenção na data da etapa,
  sem jornada, planejador liberado, escala do mês da etapa salva e lista conferida. Filtro
  "só com pendência", liberar o planejador em lote e "Circular aos clientes", que abre a
  Circular (WhatsApp) com o texto pronto para o escritório revisar e enviar.
- **Aditivo de jornada** (`src/lib/generateAditivoJornadaPdf.ts`, botão em cada
  funcionário): termo aditivo em PDF com a nova jornada, a anterior, a manutenção do
  salário e o art. 468 da CLT; opcionalmente grava a nova jornada no cadastro. Recusa
  gerar jornada fora da regra da data de início.

## Próximas partes

3. Distribuição automática de escalas (6x1 hoje, 12x36, folga fixa ou variável).
4. Assistente de IA (API do Claude com ferramentas) que analisa e aplica na escala.
