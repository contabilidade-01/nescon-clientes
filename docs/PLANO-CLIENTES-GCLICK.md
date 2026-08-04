# Plano — Cadastro de clientes: o G-Click descobre, nós decidimos

**Status: IMPLEMENTADO** (fases 1, 2, 3, 5 e 6). A **Fase 4 saiu de escopo** por decisão do Jean —
o cadastro automático de cliente quando chega guia continua ligado. O documento fica como registro
do raciocínio e do que ficou de fora.

Planejado em 03/08/2026; implementado em 04/08/2026.

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

## 9. Fases de implementação

Seis fases. **Cada uma é um commit que sobe sozinho sem quebrar o que está no ar** — dá para parar
em qualquer ponto. A ordem não é estética: cada fase depende da anterior e a Fase 4 (a única
arriscada) só entra depois que já existe um caminho para cadastrar cliente.

Regra de escopo, válida para todas: **só tocar nos arquivos listados em "Toca"**. O que estiver em
"Não toca" fica de fora mesmo que pareça uma melhoria óbvia — vira item separado.

---

### Fase 1 — Espelho e backfill

**Objetivo:** as tabelas existirem e a primeira carga não gerar alarme falso.

Passos:

1. Criar `api/src/ensureGclickClientsSchema.js` com `gclick_clients`, `gclick_pendencias`, o índice
   único parcial e `companies.gclick_status` (SQL da seção 4).
2. Registrar no boot em `api/src/index.js`, depois de `ensureLicensesSchema`.
3. Replicar em `db/init.sql` para instalações novas.
4. Implementar o backfill (seção 5) dentro do próprio `ensure*`: se `gclick_clients` estiver vazia,
   popular do G-Click e marcar como `aceito` quem já existe em `companies`, **sem criar pendência**.

**Toca:** `api/src/ensureGclickClientsSchema.js` (novo), `api/src/index.js`, `db/init.sql`.
**Não toca:** `sync.js`, rotas, front.
**Pronto quando:** a API sobe, o log mostra a linha do schema, `gclick_clients` tem uma linha por
cliente do G-Click e `SELECT count(*) FROM gclick_pendencias` devolve **0**.

---

### Fase 2 — Sincronização de clientes

**Objetivo:** detectar cliente novo e mudança de status, sem ainda decidir nada.

> **Herança da Fase 1, não esquecer.** O backfill deixou no espelho clientes com
> `decisao='pendente'` (existem no G-Click, não existem em `companies`) e **nenhuma
> pendência criada**. Como esses CNPJs já estão no espelho, o ramo "se não existe no
> espelho" do pseudocódigo abaixo nunca os alcançaria e eles ficariam invisíveis para
> sempre. A sincronização precisa, portanto, abrir `novo_cliente` para **toda linha com
> `decisao='pendente'` sem pendência aberta** — e não só para quem apareceu agora. Isso
> também deixa o processo auto-corretivo: alerta apagado por engano volta sozinho.

Passos:

1. Criar `api/src/gclick/clientSync.js` com `sincronizarClientes()` — o pseudocódigo de 6.1.
2. Extrair a regra de decisão para uma função **pura** (`decidirEventos(espelho, doGclick, opts)`)
   que devolve o que fazer, sem tocar no banco. É o que torna a Fase 2 testável de verdade.
3. Ler `GCLICK_ALERTA_SO_ATIVOS` (padrão `true`) e documentar em `.env.example`.
4. Chamar `sincronizarClientes()` no início de `sincronizar()` (documentos), para uma sync só
   atualizar as duas coisas.
5. Testes em `src/test/gclickClientSync.test.ts` sobre a função pura:
   - cliente novo ativo → gera pendência; novo já desativado → não gera (opção ligada);
   - rodar duas vezes → **uma** pendência só (idempotência);
   - rejeitado que continua igual → nada; rejeitado **reativado** → volta a perguntar;
   - mudança de status em cliente aceito → pendência informativa;
   - primeira carga com empresas já existentes → zero pendências.

**Toca:** `api/src/gclick/clientSync.js` (novo), `api/src/gclick/sync.js` (só a chamada),
`.env.example`, `src/test/gclickClientSync.test.ts` (novo).
**Não toca:** `mapaEmpresas()` ainda continua criando empresa — muda só na Fase 4.
**Pronto quando:** os testes passam e, rodando a sync duas vezes seguidas, o número de pendências
não muda.

---

### Fase 3 — Rotas de decisão

**Objetivo:** aceitar, rejeitar, reconsiderar e dar ciente — pela API.

Passos:

1. Criar `api/src/routes/gclickClients.js` com as 7 rotas da seção 7, todas atrás de `adminOnly`.
2. `aceitar` roda em **transação**: cria a empresa via `insertCompanyRow()`, grava `company_id` e
   `decisao='aceito'`, resolve a pendência. Se qualquer passo falhar, nada fica pela metade.
3. `aceitar` em CNPJ que já virou empresa por fora: não duplicar — vincular a existente.
4. Montar em `/api/gclick-clientes` no `index.js`.

**Toca:** `api/src/routes/gclickClients.js` (novo), `api/src/index.js` (uma linha).
**Não toca:** front, `sync.js`.
**Pronto quando:** dá para aceitar e rejeitar um cliente por `curl` e o efeito aparece em
`companies` e em `gclick_clients`.

---

### Fase 4 — A sync para de criar empresa — **FORA DO ESCOPO (decidido em 04/08/2026)**

> **Não implementar.** O Jean decidiu **manter** o cadastro automático de cliente quando chega
> guia. Consequência assumida: o botão "não cadastrar" **não segura** cliente que já tenha guia —
> a lista de novos vira **aviso**, não porteiro. Se um dia mudar de ideia, isto volta atrás de uma
> chave `GCLICK_AUTOCRIAR_EMPRESA` (padrão ligada), sem refazer as outras fases.
>
> As fases 5 e 6 continuam valendo e não dependem desta.
>
> O texto abaixo fica como registro do desenho, caso a chave seja implementada.

**Objetivo:** fechar a porta dos fundos. **É a fase de risco** — só depois das 1 a 3.

Passos:

1. Em `mapaEmpresas()`: trocar o `INSERT` por resolução **apenas** de quem tem `decisao='aceito'`.
2. CNPJ desconhecido: registrar no espelho + abrir pendência `novo_cliente` e **pular a guia**.
3. Trocar o contador `empresasCriadas` (que passa a ser sempre 0) por `clientesNovos` e
   `guiasAguardando`, no retorno de `sincronizar()`, em `GET /admin/sync-gclick/status`, no tipo
   `syncStatus` de `src/lib/api.ts` e no `AdminSyncCard`. **Senão o painel passa a mentir.**

**Toca:** `api/src/gclick/sync.js`, `api/src/routes/admin.js` (status), `src/lib/api.ts` (tipo),
`src/components/AdminSyncCard.tsx` (rótulos).
**Não toca:** gravação de guias, retenção (`released_at`), rotas `/api/fiscal/*`.
**Pronto quando:** uma sync com CNPJ desconhecido **não** cria empresa, abre pendência, e a guia
entra normalmente na sync seguinte depois do aceite.

> Confirmar as 3 decisões da seção 10 **antes** de começar esta fase.

---

### Fase 5 — Tela

**Objetivo:** o admin resolver as pendências sem `curl`.

Passos:

1. Métodos em `src/lib/api.ts` (bloco `gclickClientes`), seguindo o padrão dos blocos existentes.
2. `src/pages/admin/ClientesGclickPage.tsx` com as três abas da seção 8, usando `AdminLayout`.
3. Rota em `App.tsx` + item no `AdminLayout` (seção **Cadastro**) com badge do total de pendências.
4. `GclickAlertaDialog`: modal automático uma vez por sessão (`sessionStorage`), disparado na
   Visão geral. Fechar não resolve — o badge continua.
5. Bloco de pendências na Visão geral, no mesmo formato dos cartões clicáveis que já existem lá.

**Toca:** `src/pages/admin/ClientesGclickPage.tsx` e `src/components/admin/GclickAlertaDialog.tsx`
(novos), `src/lib/api.ts`, `src/App.tsx`, `src/components/admin/AdminLayout.tsx`,
`src/pages/admin/VisaoGeralPage.tsx`.
**Não toca:** as outras páginas do admin, o portal do cliente.
**Pronto quando:** o roteiro de validação da seção 9.1 passa inteiro.

---

### Fase 6 — Acabamento — **FEITA**

1. ✅ Switch **"alertar só sobre clientes ativos"** em `/admin/sincronizacao`, gravado em
   `app_settings` (a variável de ambiente vira apenas o padrão). Junto veio o botão
   **Conferir clientes agora**, que atualiza só o espelho — segundos, não minutos.
2. ✅ Selo **"inativo no G-Click"** no cadastro da empresa, lendo `companies.gclick_status`.
3. ❌ Contador **"guias aguardando cadastro"**: **não faz sentido e não foi feito**. Ele existia
   para a Fase 4, que saiu de escopo — com a criação automática ligada, nenhuma guia fica
   esperando cadastro, então o número seria sempre zero. Se um dia a chave
   `GCLICK_AUTOCRIAR_EMPRESA` for implementada, este item volta junto.

**Toca:** `src/pages/admin/SincronizacaoPage.tsx`, `src/components/admin/CompanyManageRow.tsx`,
`src/components/AdminSyncCard.tsx` (+ a rota da configuração).

---

### 9.1 Roteiro de validação (depois da Fase 5)

| # | Ação | Esperado |
|---|------|----------|
| 1 | Subir com o banco já populado | Zero pendências (backfill funcionou) |
| 2 | Rodar a sync duas vezes | O número de pendências não muda |
| 3 | Entrar no `/admin` com pendências | Modal aparece uma vez; badge no menu |
| 4 | Trocar de página e voltar | Modal **não** reaparece; badge continua |
| 5 | Cadastrar um cliente novo | Vira empresa, some de *Novos*, login por CNPJ funciona |
| 6 | Rejeitar outro | Vai para *Rejeitados*; sync seguinte **não** o traz de volta |
| 7 | *Cadastrar agora* num rejeitado | Vira empresa normalmente |
| 8 | Simular desativação no G-Click | Alerta informativo; **cliente continua acessando o portal** |
| 9 | Dar OK no alerta | Some da lista e fica no histórico |

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
