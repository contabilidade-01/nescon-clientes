# Plano — Férias na palma da mão do cliente

Traz para o Portal do Cliente o que hoje vive num app separado feito no Lovador
(`clientesnescon-main`): previsão de férias, custo e limite de faltas.

Data: 04/08/2026. Base: commit `dda1fa2`.

---

## 1. O que o cliente vai ver

| # | Entrega | De onde sai o dado |
|---|---------|--------------------|
| 1 | **Quem tem direito e quando** | Programação de Férias (PDF) |
| 2 | **Quanto vão custar as férias** | Programação de Férias × salário do Extrato |
| 3 | **Limite de faltas**, com alerta antes de perder dias | Faltas da Programação de Férias |

O **limite de gozo entra no calendário** do cliente, junto de guias e boletos.

> O funcionário não tem login no portal. O alerta chega ao **empregador**, que avisa a
> pessoa. Falar direto com o funcionário seria outro projeto.

## 2. Decisões fechadas (04/08/2026)

1. **A Programação de Férias NÃO sai pela API do G-Click.** Entra por **upload de PDF**.
   Mais tarde o Jean vai criar uma tarefa no G-Click para isso — então a ingestão nasce
   **agnóstica de origem**: a mesma função que grava a partir do upload deve servir a um
   `source: 'gclick'` depois, sem reescrita. É o mesmo desenho de `deliverables`.
2. **Custo inclui encargos, e o encargo é só o FGTS** (8%). Sem INSS patronal — a maioria
   dos clientes é Simples, onde a contribuição patronal já está no DAS, então o custo
   marginal das férias é férias + 1/3 + FGTS sobre isso.
3. **Sem tela nova de admin.** A importação entra no que já existe (ver §5). Nada de
   página nova, nada de item novo no menu.
4. Acesso: por enquanto sob a área **`funcionarios`**. Se um dia o Jean quiser delegar
   **só** as férias sem dar o quadro de pessoal inteiro, vira uma área própria — é uma
   chave em `api/src/adminAreas.js` + `src/lib/adminAreas.ts` e o gate. Não fazer agora.

## 3. O que foi aproveitado do app anterior (e o que não)

O app tem 6.663 linhas, 3.267 numa tela só, e roda em TanStack Start + Supabase (auth
Supabase, RLS, server functions). O nosso é Express + Postgres + SPA com JWT. **Migrar
significaria reescrever autenticação, multiempresa e interface** — ou seja, tudo menos as
~250 linhas que interessam. Por isso: **portar as regras, escrever o resto no nosso padrão.**

**Aproveitado:** o parser da Programação de Férias, os campos que faltam no nosso parser
de extrato (salário, faltas), a tabela do Art. 130, a ideia do *limite de segurança* e a
fórmula do custo.

**Descartado:** Supabase, TanStack Start, `user_roles`, `companies`, `guias`, sync do
G-Click, fallback de IA no parser (mantemos determinístico) e a tela-monólito.

## 4. Achados que mudam a implementação

**4.1 O parser deles não roda no nosso sistema sem adaptação.** Ele depende do `unpdf`,
que remonta linhas por coordenada e entrega `código nome datas…`. Nós usamos `pdf-parse`,
e o mesmo PDF sai com o **nome primeiro**:

```
ANA CLAUDIA CICERO DE FREITAS SALES	30 29/11/2025 1 01/12 29/11/2025	28/11/2026 .... 30 0 30 30/10/2027 - -
```

É o mesmo problema já documentado em `api/src/extratoEmployees.js` (ordem de campos muda
conforme o extrator). **Escrever o parser tolerante às duas ordens**, como fizemos lá, em
vez de acrescentar o `unpdf`.

**4.2 Falta salário no nosso banco.** Hoje o extrato entra e guardamos só nome e CPF. Sem
salário não há custo.

**4.3 O código do funcionário é a chave de casamento.** O app deles cruza férias × folha
**por nome normalizado** — quebra com acento e grafia. A Programação traz `código + nome`;
o extrato traz `código + nome + CPF`. Nosso parser de extrato **já lê o código e o
descarta**. Guardá-lo dá um casamento confiável dentro da empresa, com o nome como
segunda tentativa.

**4.4 Dias de direito já vêm calculados.** No PDF, FLAVIA com 11 faltas aparece com 24
dias; GRAZIELI com 13, também 24. O G-Click já aplica o Art. 130. Nós **não recalculamos**
— usamos o que veio e aplicamos a tabela só para dizer **quantas faltas faltam para cair
para a próxima faixa**, que é o alerta útil.

## 5. Onde cada coisa entra (sem tela nova)

| Função | Onde |
|--------|------|
| Subir a Programação de Férias | Card novo em **`/admin/empresas`**, dentro da empresa selecionada, ao lado de "Importar funcionários" e "Ler extrato" (`CompanyManageRow`) |
| Conferir o que foi importado | O próprio card mostra o resumo da última importação |
| Ver férias do cliente | Seção **Férias** no portal, chave nova em `tool_access` |
| Limite de gozo no calendário | Alimenta o calendário que já existe |

## 6. Modelo de dados

```sql
-- Extrato passa a guardar o que faltava
ALTER TABLE employees ADD COLUMN IF NOT EXISTS codigo TEXT;          -- casamento com a Programação
ALTER TABLE employees ADD COLUMN IF NOT EXISTS salario_base NUMERIC(12,2);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS salario_competencia TEXT;  -- de qual folha veio

-- Uma linha por importação (histórico e comparação entre versões)
CREATE TABLE vacation_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  data_base DATE, emissao DATE,
  arquivo_nome TEXT, total_empregados INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',   -- 'manual' hoje, 'gclick' quando houver tarefa
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uma linha por funcionário × período aquisitivo
CREATE TABLE vacation_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES vacation_uploads(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  codigo TEXT, nome TEXT NOT NULL, admissao DATE,
  inicio_aquisitivo DATE, fim_aquisitivo DATE,
  inicio_gozo DATE, dias_direito NUMERIC(5,1), dias_gozados NUMERIC(5,1),
  dias_restantes NUMERIC(5,1), limite_gozo DATE,
  dias_afastamento INTEGER, faltas INTEGER,
  ordem INTEGER
);
```

**Só a última importação vale** para as telas; as anteriores ficam como histórico. Mesma
escolha do espelho do G-Click: o dado bruto é rastreável, mas quem manda é a versão atual.

## 7. Regras, num lugar só

`api/src/vacationRules.js` — puro, sem banco, testado (padrão de `licenseStatus.js`):

```js
FAIXAS_ART130 = [ {ate: 5, dias: 30}, {ate: 14, dias: 24},
                  {ate: 23, dias: 18}, {ate: 32, dias: 12}, {ate: Infinity, dias: 0} ]

faltasParaProximaPerda(faltas)  // 11 faltas -> { proximaFalta: 15, perde: 6 }
limiteSeguranca(limiteGozo)     // 30 dias antes do limite oficial
custoFerias(salario, dias)      // (salario/30*dias) * 4/3 * 1,08  → { bruto, umTerco, fgts, total }
situacao(limiteGozo, hoje)      // 'vencida' | 'a_vencer' | 'ok'   (mesma ideia das licenças)
```

**FGTS incide sobre férias + 1/3** — por isso o `1,08` multiplica o total, não só o bruto.

## 8. Fases

| Fase | Entrega | Pronto quando |
|------|---------|---------------|
| **1** | Extrato passa a guardar **código** e **salário base** | Importar um extrato e ver as colunas preenchidas |
| **1b** | **Leitura automática do extrato** ao fim de cada sincronização | Sincronizar e ver código/salário preenchidos sem ninguém clicar |
| **2** | `vacationRules.js` + testes | Testes cobrindo faixas, fronteiras (5/6, 14/15) e custo |
| **3** | Parser da Programação + tabelas + rota de upload | Subir o PDF do QUEIJEIRO 3 e ver 15 funcionários e seus períodos |
| **4** | Card de importação em `/admin/empresas` | Escritório sobe o PDF sem `curl` |
| **5** | Seção **Férias** no portal + chave em `tool_access` | Cliente vê os três números |
| **6** | Limite de gozo no calendário | Aparece junto de guias e boletos |

**Todas as fases foram implementadas em 04/08/2026.** Duas decisões tomadas na execução:

- O calendário marca o **limite de segurança**, não o limite oficial. Avisar no dia do
  prazo é avisar quando já não há o que fazer.
- O custo desconta os **dias já gozados**: quem tirou 10 de 24 dias só tem 14 a pagar.

Regra de escopo: pode alterar o que for necessário, desde que não mude o comportamento do
que já funciona.

## 8.1 Fase 1b — por que a inativação NÃO é automática

O extrato já chegava sozinho do G-Click; só a leitura era manual. Agora ela roda ao fim
de cada sincronização, mas com uma separação deliberada:

- **cadastrar e atualizar** quem está no extrato roda sozinho — é aditivo e reversível;
- **inativar quem sumiu** vira um **aviso** em `/admin/funcionarios`, para alguém confirmar.

O motivo é o modo de falha. Um PDF lido pela metade traz 8 de 15 funcionários; os outros
7 seriam inativados em silêncio, sumiriam da tela do cliente, e você só descobriria quando
ele reclamasse. Cadastrar a mais aparece na tela; inativar a menos, não.

Duas salvaguardas juntas: **só processa quando o extrato muda** (a marca é o id da
entrega, então retificação do mesmo mês também é relida) e **parse vazio não marca como
processado** — na próxima rodada tenta de novo, em vez de dar o arquivo por lido.

A importação manual continua inativando na hora: ali a revisão humana é o próprio clique.
Ela também fecha os avisos abertos dessas pessoas, para não pedir a mesma confirmação duas
vezes.

## 9. Em aberto

- **Salário de quem não está no extrato mais recente** (admitido depois, afastado): o
  custo fica sem base. Proposta: mostrar o funcionário com o custo em branco e um aviso,
  em vez de exibir R$ 0,00 — zero mente, branco pergunta.
- **Férias já gozadas**: o PDF traz `dias gozados`; decidir se a lista do cliente esconde
  quem já gozou tudo ou mostra como "quitado".
