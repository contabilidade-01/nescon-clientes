# Plano — Simulador de regime no Simples (IBS/CBS)

Data: 26/10/2026. Plano aprovado pelo Jean no mesmo dia (doc: https://claude.ai/artifact/NVQ8W2psmrNi84muGxmVsw).

Por cliente, o simulador faz um questionário da atividade, pede os dados que faltam e
compara, ano a ano de 2027 a 2033, três caminhos:

| Cenário | IBS/CBS | Crédito nas compras | Crédito do comprador |
| --- | --- | --- | --- |
| Simples puro | Dentro do DAS | Não | Só o IBS/CBS pago no DAS |
| Simples híbrido | Por fora, regime regular; DAS sem a parcela de IBS/CBS | Integral | Integral |
| Lucro Presumido | Regime regular + IRPJ/CSLL presumidos, INSS sobre a folha, ICMS/ISS até 2032 | Integral | Integral |

## Onde está

- **Regras** — `src/lib/regime/regras.ts`: transição ano a ano, alíquotas de referência
  (estimadas até a resolução do Senado), reduções, Lucro Presumido, INSS, prazos de opção
  e a lista de fontes (cada uma marcada "conferido" ou "a conferir"). Lei nova = linha
  nova aqui; o cálculo não muda.
- **Tabelas do Simples** — `src/lib/regime/simples.ts`: Anexos I a V com partilha, alíquota
  efetiva e o teto de 5% do ISS dentro do DAS.
- **Cálculo** — `src/lib/regime/simular.ts`. Régua: o comprador sente o mesmo preço nos três
  cenários (quem toma crédito, o mesmo custo líquido; quem não toma, o mesmo preço bruto);
  o resultado é quanto sobra para a empresa. Também calcula o ponto de virada (a partir de
  que % de vendas a empresas do regime regular o híbrido compensa), pendências dos dados e
  a recomendação com os motivos.
- **Telas** — `src/components/regime/`: abas Questionário (5 passos), Cenários (recomendação,
  prazos, "e se", cartões por ano e gráfico 2027-2033) e Regras e prazos.
  - Painel `/admin/regime` (área `empresas`): o escritório simula QUALQUER cliente.
  - Portal `/regime`: ferramenta `regime_tributario`, que **nasce desligada**; o escritório
    liga em Empresas → "Simulador de regime (IBS/CBS)".
- **Salvar** — `api/src/routes/regime.js` (`/api/regime`), tabela `regime_simulacoes`
  (uma linha por empresa, JSONB).

## Limites conhecidos (próximos passos)

- Acima de R$ 3,6 mi (sublimite) o ICMS/ISS fora do DAS ainda não entra no Simples.
- Lucro Real não está na comparação.
- Crédito de fornecedor do Simples usa a média do Anexo I, 3ª faixa.
- Falta: relatório em PDF para o cliente assinar e histórico de simulações.
- Conferir no texto oficial os itens "a conferir" (LC 214 consolidada, Res. CGSN 194/2026).
