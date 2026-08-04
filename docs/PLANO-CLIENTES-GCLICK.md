# Plano — Cadastro de clientes: o G-Click descobre, nós decidimos

**Status: PLANEJADO, nada implementado ainda.** Este documento existe para que a implementação
possa ser retomada em outra sessão sem reconstruir o raciocínio.

Data: 03/08/2026. Base: commit `3f16689`.

---

## 1. O problema com o comportamento atual

Hoje a sincronização **cria empresa sozinha**. Em `api/src/gclick/sync.js`, a função
`mapaEmpresas()` faz `INSERT ... ON CONFLICT DO NOTHING` para todo CNPJ que apareça numa guia. Isso
tem três consequências ruins:

1. O escritório **não escolhe** quem entra no portal — qualquer cliente novo no G-Click vira empresa
   com login ativo, sem ninguém saber.
2. Não existe registro de **cliente que não queremos** no portal: na próxima sync ele volta.
3. Cliente **desativado** no G-Click continua igual no portal, e ninguém fica sabendo.

Além disso, a sync traz **todos** os clientes, ativos ou não.

## 2. O que queremos

| # | Regra |
|---|-------|
| R1 | Opção de trazer do G-Click **apenas clientes ativos** |
| R2 | Depois da carga, **o cadastro é nosso**: o G-Click não sobrescreve mais nome, e-mail e telefone |
| R3 | Cliente **novo** (ainda não cadastrado) gera **alerta ao admin** ao entrar no sistema, com opção de cadastrar **ou não** |
| R4 | Quem não for cadastrado fica num controle de **rejeitados** — pode ser cadastrado depois |
| R5 | **Mudança de status** no G-Click (ativado/desativado) gera alerta **apenas informativo**: o admin dá OK |

A diferença entre R3 e R5 é o ponto central: **novo cliente é uma decisão** (aceitar/rejeitar),
**mudança de status é uma notícia** (ciente).

## 3. A ideia que sustenta o desenho

Separar em três coisas que hoje estão misturadas numa só:

| Camada | Quem manda | Papel |
|--------|-----------|-------|
| **Espelho** (`gclick_clients`) | G-Click | Cópia crua do que existe lá. Reescrito a cada sync. Nunca é mostrado ao cliente. |
| **Decisão** (coluna em `gclick_clients`) | Escritório | pendente / aceito / rejeitado. Dura para sempre. |
| **Cadastro** (`companies`) | **Nós** | Só nasce quando o admin aceita. Depois disso o G-Click não toca mais nele. |

Com isso, R2 sai de graça: a sync escreve no **espelho**, nunca em `companies`. E as diferenças
entre o espelho e o nosso cadastro deixam de ser um problema — passam a ser informação.

> **Detalhe que parece contraintuitivo, mas é necessário:** o espelho precisa buscar **todos** os
> clientes, inclusive os desativados. É a única forma de perceber que alguém *foi* desativado (R5).
> O "só ativos" de R1 não é um filtro na busca — é um filtro em **quem gera alerta de cadastro**.

---

## 4. Modelo de dados

### `gclick_clients` — espelho + decisão

```sql
CREATE TABLE IF NOT EXISTS gclick_clients (
  cnpj TEXT PRIMARY KEY,
  -- Espelho do G-Click (sempre sobrescrito pela sync)
  nome TEXT,
  email TEXT,
  phone TEXT,
  status_gclick TEXT,                       -- 'ATIVO' | 'DESATIVADO'
  -- Decisão do escritório (a sync NUNCA altera)
  decisao TEXT NOT NULL DEFAULT 'pendente'  -- 'pendente' | 'aceito' | 'rejeitado'
    CHECK (decisao IN ('pendente','aceito','rejeitado')),
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  decidido_em TIMESTAMPTZ,
  motivo_rejeicao TEXT,
  primeiro_visto_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `gclick_pendencias` — a caixa de alertas

```sql
CREATE TABLE IF NOT EXISTS gclick_pendencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('novo_cliente','status_alterado')),
  dados JSONB NOT NULL DEFAULT '{}',   -- nome/email/phone; ou {de:'ATIVO', para:'DESATIVADO'}
  situacao TEXT NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente','resolvido')),
  resolucao TEXT CHECK (resolucao IN ('cadastrado','rejeitado','ciente')),
  resolvido_em TIMESTAMPTZ,
  resolvido_por UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uma pendência aberta por CNPJ e tipo: sync repetida não empilha o mesmo alerta.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gclick_pendencias_abertas
  ON gclick_pendencias(cnpj, tipo) WHERE situacao = 'pendente';
```

O índice parcial é o que torna a sync **idempotente**: rodar dez vezes seguidas não gera dez
alertas. Mesmo padrão já usado em `deliverables(company_id, external_ref)`.

### Coluna informativa em `companies`

```sql
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gclick_status TEXT;
```

Só para mostrar um selo "inativo no G-Click" no cadastro. **Não** bloqueia login nem mexe em
permissões — inativação é notícia, não ação (R5).

Tudo isso em `api/src/ensureGclickClientsSchema.js`, chamado no boot como os outros `ensure*`, e
espelhado em `db/init.sql`.

---

## 5. O backfill (o passo que evita 60 alertas falsos)

Na **primeira execução** depois do deploy, `gclick_clients` está vazio — sem cuidado, todo cliente
já existente pareceria "novo" e o admin abriria o painel com dezenas de alertas.

Regra da primeira carga:

1. Buscar todos os clientes do G-Click e popular o espelho.
2. Para cada CNPJ que **já existe em `companies`**: `decisao = 'aceito'`, `company_id` preenchido,
   `status_gclick` gravado como linha de base. **Nenhuma pendência criada.**
3. Para os demais: `decisao = 'pendente'`, e aí sim geram alerta conforme R1/R3.

Detectar "primeira execução" = tabela `gclick_clients` vazia. Simples e sem flag extra.

---

## 6. Como fica a sincronização

### 6.1 Nova função: `sincronizarClientes()`

Arquivo novo `api/src/gclick/clientSync.js` (não misturar com o sync de documentos):

```
para cada cliente do G-Click (client.listarClientes + extrairDadosCliente):
  existente = espelho[cnpj]

  se não existe no espelho:
      inserir no espelho (decisao='pendente')
      se status == 'ATIVO' ou GCLICK_ALERTA_SO_ATIVOS=false:
          abrir pendência 'novo_cliente'
      # cliente que nasce já desativado não incomoda ninguém

  se existe:
      atualizar nome/email/phone/status no espelho   <- só o espelho
      se status mudou E decisao == 'aceito':
          abrir pendência 'status_alterado' {de, para}
          atualizar companies.gclick_status
      se status mudou de DESATIVADO para ATIVO E decisao == 'rejeitado':
          # reativado lá fora: vale reperguntar
          abrir pendência 'novo_cliente'
```

Quem está **rejeitado** e continua desativado ou ativo do mesmo jeito **não gera nada** — é
exatamente o efeito que o controle de rejeitados precisa ter (R4).

### 6.2 O sync de documentos para de criar empresa

Em `api/src/gclick/sync.js`, `mapaEmpresas()` deixa de inserir. Passa a:

- resolver CNPJ → `company_id` **só** para quem tem `decisao='aceito'`;
- para CNPJ desconhecido: registrar no espelho (`decisao='pendente'`) + abrir pendência
  `novo_cliente`, e **pular a guia**.

A guia **não se perde**: como nada foi gravado, a próxima sync reprocessa aquela competência e,
se o admin já tiver cadastrado a empresa, ela entra normalmente. Vale expor um contador
"guias aguardando cadastro" para isso não virar silêncio.

> **Ponto de atenção na implementação:** hoje `sincronizar()` conta `empresasCriadas`. Esse número
> passa a ser sempre 0; trocar por `clientesNovos` / `guiasAguardando` no retorno e no painel, senão
> o card de sincronização mente.

### 6.3 A opção "só clientes ativos" (R1)

- Variável `GCLICK_ALERTA_SO_ATIVOS` (padrão `true`) em `.env.example`.
- Switch equivalente na página `/admin/sincronizacao`, para não exigir redeploy.
- Reforçando o item 3: o espelho sempre traz todo mundo; a opção controla **quem vira alerta**.

---

## 7. API

Todas exigem admin (mesmo `adminOnly` das outras rotas). Arquivo `api/src/routes/gclickClients.js`,
montado em `/api/gclick-clientes`.

| Rota | Para quê |
|------|----------|
| `GET /pendencias` | Alertas abertos, separados por tipo. É o que o painel consulta ao abrir. |
| `GET /` | Espelho completo, filtrável por `decisao` e `status_gclick` (alimenta as abas, inclusive Rejeitados). |
| `POST /:cnpj/aceitar` | Cria a empresa (dados do espelho **no momento do aceite**), liga `company_id`, `decisao='aceito'`, resolve a pendência como `cadastrado`. |
| `POST /:cnpj/rejeitar` | `decisao='rejeitado'` + `motivo_rejeicao` opcional; resolve a pendência como `rejeitado`. |
| `POST /:cnpj/reconsiderar` | Rejeitado → `pendente`, para poder cadastrar depois (R4). |
| `POST /pendencias/:id/ciente` | Dá o OK numa mudança de status (R5). |
| `POST /sincronizar-clientes` | Roda `sincronizarClientes()` sob demanda. |

O aceite reaproveita `insertCompanyRow()` de `api/src/toolAccessDb.js` — senha inicial = CNPJ,
`must_change_password=true`, `tool_access = PORTAL_ONLY_TOOL_ACCESS`. É o mesmo que o sync fazia;
a diferença é que agora **alguém decidiu**.

---

## 8. Front

### Página nova: `/admin/clientes-gclick`

Entra no menu lateral, seção **Cadastro**, com **badge do número de pendências**. Três abas:

1. **Novos** — cartão por cliente com nome, CNPJ, e-mail e status no G-Click, e dois botões:
   **Cadastrar** e **Não cadastrar**. O segundo pede (opcionalmente) um motivo.
2. **Mudanças de status** — linha por evento: "FULANO LTDA: ATIVO → DESATIVADO em 02/08". Um botão
   **OK, ciente**. Sem opção de recusar: é informação.
3. **Rejeitados** — quem foi recusado, com o motivo e um botão **Cadastrar agora**.

### O alerta ao entrar (R3)

- **Badge permanente** no menu lateral e um bloco no topo da Visão geral — não some até resolver.
- **Modal automático** ao abrir o painel, **uma vez por sessão**, quando houver pendências. Fechar
  não resolve nada: o badge continua. Mesma lógica de "mostrar sem prender" já usada no aviso de
  LGPD, para o admin não ficar refém de um pop-up toda vez que troca de página.

Guardar o "já mostrei nesta sessão" em `sessionStorage`, não no banco: é conforto de tela, não
registro de auditoria — quem registra é `gclick_pendencias`.

---

## 9. Ordem de implementação

Cada fase fecha um commit que sobe sozinho, sem quebrar o que está no ar.

| Fase | O que entra | Por que nesta ordem |
|------|-------------|---------------------|
| **1** | Schema (`ensureGclickClientsSchema.js`) + backfill | Sem o backfill, qualquer coisa depois gera alarme falso |
| **2** | `clientSync.js` + rota `POST /sincronizar-clientes` | Dá para validar o espelho e as pendências pela API antes de existir tela |
| **3** | Rotas de decisão (aceitar/rejeitar/ciente/reconsiderar) | Backend fechado e testável |
| **4** | `sync.js` para de criar empresa; contadores novos | Só depois que existe um caminho para cadastrar, senão cliente novo ficaria sem porta de entrada |
| **5** | Página `/admin/clientes-gclick` + badge + modal | Interface por cima de um backend já pronto |
| **6** | Switch "só ativos" na tela de sincronização; selo "inativo no G-Click" no cadastro | Acabamento |

**Testes** (`src/test/`), no mesmo espírito de `licenseStatus.test.ts` — testar a regra de decisão,
que é onde mora o risco:

- cliente novo ativo → gera pendência; novo já desativado → não gera (com a opção ligada);
- rodar a sync duas vezes → uma pendência só;
- rejeitado que continua igual → nada; rejeitado que é reativado → volta a perguntar;
- primeira carga com empresas já existentes → zero pendências;
- mudança de status em cliente aceito → pendência informativa.

---

## 10. Decisões a confirmar antes da Fase 4

1. **Cliente desativado no G-Click perde acesso ao portal?** Proposta: **não** — só ganha o selo e
   o alerta. Desligar o acesso continua sendo ação manual do admin. (É o que R5 pede, mas convém
   confirmar, porque o oposto é defensável.)
2. **Guias de cliente ainda não cadastrado.** Proposta: ficam de fora e entram na próxima sync após
   o cadastro. A alternativa — guardar o PDF órfão — complica sem ganho claro.
3. **Divergência de dados** (nome mudou no G-Click depois do aceite). Proposta para agora: só
   mostrar a diferença na tela do cliente. Aplicar com um clique fica para depois, se incomodar —
   R2 diz que o dado é nosso, então nada é automático.

---

## 11. Arquivos que a implementação toca

**Novos:** `api/src/ensureGclickClientsSchema.js`, `api/src/gclick/clientSync.js`,
`api/src/routes/gclickClients.js`, `src/pages/admin/ClientesGclickPage.tsx`,
`src/components/admin/GclickAlertaDialog.tsx`, `src/test/gclickClientSync.test.ts`.

**Alterados:** `api/src/index.js` (schema + rota), `api/src/gclick/sync.js` (não criar empresa),
`db/init.sql`, `src/lib/api.ts`, `src/App.tsx` (rota), `src/components/admin/AdminLayout.tsx`
(item + badge), `src/pages/admin/VisaoGeralPage.tsx` (bloco de pendências),
`src/pages/admin/SincronizacaoPage.tsx` (switch e botão), `.env.example`, `README.md`.
