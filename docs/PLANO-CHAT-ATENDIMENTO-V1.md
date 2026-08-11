# Chat/Atendimento Interno — Portal do Cliente (v1)

## Status: PLANEJADO (não implementado)

Data: 11/08/2026
Sessão anterior: integração boletos Cora (concluída e deployada)

---

## Visão geral

Módulo de comunicação escritório↔cliente **dentro do portal**. O cliente envia mensagens pelo portal, o escritório responde pelo painel admin. Sem WhatsApp na v1 — a evolução futura (v2) adicionará espelhamento.

### Fluxo

```
[Cliente no Portal]  ──mensagem──►  [banco: conversations + messages]
                                              │
[Admin no Portal]   ◄──polling 5s──  [fila de atendimentos]
      │
      ├── "Assumir" → assigned_to = eu
      ├── "Responder" → nova message sender_type='admin'
      ├── "Transferir" → muda assigned_to + log
      └── "Resolver" → status = resolvido
```

---

## Requisitos funcionais

### Para o cliente
- Nova seção **"Mensagens"** no menu lateral (controlada por `tool_access.chat`)
- Tela: lista de conversas anteriores + botão "Nova conversa"
- Dentro da conversa: balões de chat, input de texto, enviar
- Vê respostas do escritório em tempo real (polling 5s via React Query `refetchInterval`)
- Badge de "não lidas" no menu lateral

### Para o admin (escritório)
- Nova aba **`/admin/atendimentos`** (gated por area `atendimento`)
- Dashboard: cards com contagem por status (abertos, em atendimento, resolvidos hoje)
- Lista de conversas: empresa, assunto, status, responsável, tempo desde última msg
- Filtros: por status, por responsável (select de admins), por empresa
- Dentro da conversa: chat + painel lateral com info da empresa
- Ações:
  - **Assumir**: seta `assigned_to` = admin logado, status → `em_atendimento`
  - **Transferir**: select de colegas → muda `assigned_to` + registra mensagem de sistema
  - **Resolver**: status → `resolvido`, `resolved_at` = now()
  - **Reabrir**: status → `aberto` (se precisar retomar)
- Badge no menu: contagem de atendimentos sem responsável (fila aberta)

### Transferência de atendimento
- Qualquer admin com area `atendimento` pode transferir para qualquer outro admin ativo
- Ao transferir, uma mensagem de sistema é inserida: "Atendimento transferido de X para Y"
- O novo responsável vê a conversa na sua lista

---

## Modelo de dados

### Tabela `conversations`
```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  subject TEXT,                                    -- assunto opcional (cliente pode informar)
  status TEXT NOT NULL DEFAULT 'aberto',           -- aberto | em_atendimento | resolvido
  assigned_to UUID REFERENCES platform_admins(id), -- quem está atendendo (null = fila)
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ DEFAULT now()        -- para ordenação (mais recente primeiro)
);

CREATE INDEX idx_conversations_company ON conversations(company_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_assigned ON conversations(assigned_to) WHERE assigned_to IS NOT NULL;
```

### Tabela `messages`
```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL,    -- 'client' | 'admin' | 'system'
  sender_id UUID NOT NULL,      -- company_id (client) ou platform_admin.id (admin)
  sender_name TEXT,             -- nome para exibição (evita JOIN a cada render)
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,          -- null = não lida pelo destinatário
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
```

### Observações
- `sender_type = 'system'` para mensagens automáticas (transferência, resolução)
- `read_at` é preenchido quando o destinatário abre a conversa (marca todas até aquele ponto)
- `last_message_at` é atualizado a cada INSERT em messages (trigger ou no código)

---

## Endpoints da API

### Cliente (auth por JWT da empresa)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/chat/conversations` | Lista conversas da empresa logada |
| POST | `/api/chat/conversations` | Abre nova conversa `{ subject? }` |
| GET | `/api/chat/conversations/:id/messages` | Mensagens da conversa (paginado, cursor) |
| POST | `/api/chat/conversations/:id/messages` | Envia mensagem `{ body }` |
| POST | `/api/chat/conversations/:id/read` | Marca mensagens como lidas |
| GET | `/api/chat/unread` | `{ count: N }` — para badge no menu |

### Admin (auth + requireArea('atendimento'))

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/admin/atendimentos` | Lista todas as conversas (filtros: status, assigned_to, company_id) |
| GET | `/api/admin/atendimentos/summary` | Cards: `{ abertos, em_atendimento, resolvidos_hoje }` |
| GET | `/api/admin/atendimentos/:id/messages` | Mensagens da conversa |
| POST | `/api/admin/atendimentos/:id/messages` | Admin responde `{ body }` |
| PATCH | `/api/admin/atendimentos/:id` | Ações: `{ action: 'assumir' | 'transferir' | 'resolver' | 'reabrir', transferir_para?: UUID }` |
| POST | `/api/admin/atendimentos/:id/read` | Marca como lidas (pelo admin) |
| GET | `/api/admin/atendimentos/unread` | `{ count: N }` — badge no menu |

---

## Arquivos a criar/modificar

### Novos
- `api/src/ensureChatSchema.js` — CREATE TABLE conversations + messages (idempotente)
- `api/src/routes/chat.js` — rotas do cliente
- `api/src/routes/adminChat.js` — rotas do admin (ou adicionar em admin.js)
- `src/pages/MensagensPage.tsx` — página do cliente
- `src/pages/admin/AtendimentosPage.tsx` — página do admin
- `src/components/ChatBubble.tsx` — componente de balão de mensagem
- `src/components/ChatInput.tsx` — input de mensagem com botão enviar
- `src/components/ConversationList.tsx` — lista de conversas (reusável cliente/admin)

### Modificados
- `api/src/index.js` — boot: `await ensureChatSchema(db)` + montar rotas `/api/chat` e `/api/admin/atendimentos`
- `api/src/companyTools.js` — adicionar `chat: true` em `DEFAULT_TOOL_ACCESS`
- `api/src/adminAreas.js` — adicionar `"atendimento"` ao array de áreas
- `src/lib/adminAreas.ts` — adicionar `"atendimento"` + label
- `src/lib/api.ts` — métodos `api.chat.*` e `api.admin.atendimentos.*`
- `src/App.tsx` — rotas `/mensagens` e `/admin/atendimentos`
- `src/components/admin/AdminLayout.tsx` — item de menu "Atendimentos" (icon: MessageCircle)
- Menu lateral do cliente — item "Mensagens" com badge

---

## Padrões a seguir (referências no código)

| Padrão | Arquivo de referência |
|--------|----------------------|
| Schema migration idempotente | `api/src/ensureDeliverablesSchema.js` |
| Rota admin com requireArea | `api/src/routes/admin.js` (linhas 358-404, padrão Cora) |
| Rota do cliente com auth | `api/src/routes/deliverables.js` |
| Página admin com tabs/filtros | `src/pages/admin/BoletosCoraPage.tsx` |
| Página do cliente | `src/pages/ProximosPagamentosPage.tsx` |
| Componente com polling | `src/components/AdminSyncCard.tsx` (refetchInterval) |
| Badge no menu | `AdminLayout.tsx` → `badgePendencias` no NavItem |
| Tool access no menu cliente | `src/App.tsx` → `CompanyToolRoute` |

---

## Decisões de design já tomadas

1. **Polling, não WebSocket** — volume baixo (~60 empresas, ~5 admins), polling 5s é suficiente. WebSocket adiciona complexidade de infra (sticky sessions, Redis pub/sub) sem benefício real neste caso.

2. **Area admin `atendimento`** — separada de `sincronizacao`. O Nelson pode ter acesso ao chat sem ver a sync.

3. **Tool access `chat`** — desligável por empresa. Empresa que não quer chat não vê o menu.

4. **Sem WhatsApp na v1** — decisão explícita do usuário. v2 adicionará espelhamento.

5. **`sender_name` denormalizado** — evita N+1 de JOINs no render do chat. Gravado no INSERT.

6. **Status de 3 estados** — `aberto` (ninguém pegou), `em_atendimento` (alguém assumiu), `resolvido` (fechado). Sem estados intermediários na v1.

7. **Sem upload de arquivo no chat v1** — só texto. Anexos entram em v2.

---

## Evolução futura (v2+)

- **Espelhamento WhatsApp → Portal**: webhook uazapi grava mensagens recebidas no histórico
- **Resposta portal → WhatsApp**: ao responder no admin, envia também via uazapi
- **Notificação push**: quando admin responde, cliente recebe WhatsApp "Você tem uma nova mensagem no portal"
- **Upload de anexos**: PDF, imagens no chat
- **Respostas rápidas**: templates de texto para perguntas comuns (tipo FAQ)
- **SLA/tempo de resposta**: métricas de quanto tempo leva para responder
- **Chatbot básico**: respostas automáticas fora do horário
- **Kanban de atendimento**: arrastar conversas entre colunas (como Waspeed)

---

## Estimativa

| Parte | Linhas aprox. | Tempo |
|-------|---------------|-------|
| Backend (schema + 2 routers) | ~250 | 2h |
| Frontend cliente (página + chat) | ~200 | 2h |
| Frontend admin (dashboard + lista + chat + ações) | ~350 | 3h |
| Integrações (menu, rotas, areas, tools) | ~50 | 30min |
| **Total** | **~850** | **~8h** |

---

## Como começar

1. Criar `api/src/ensureChatSchema.js` (tabelas)
2. Criar `api/src/routes/chat.js` (rotas cliente)
3. Criar `api/src/routes/adminChat.js` (rotas admin)
4. Registrar no `index.js` (schema + rotas)
5. Adicionar area + tool (adminAreas + companyTools)
6. Frontend cliente: `MensagensPage.tsx`
7. Frontend admin: `AtendimentosPage.tsx`
8. Menu + rotas (AdminLayout + App.tsx)
9. Testar: cliente envia → admin vê → admin responde → cliente vê
10. Commit + deploy

---

## Credenciais e infra necessária

Nenhuma nova — usa o mesmo banco PostgreSQL, mesmo JWT, mesmo deploy Easypanel. Zero dependência externa na v1.
