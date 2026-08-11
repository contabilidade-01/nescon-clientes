# Chat/Atendimento — Portal do Cliente (v2, endurecido)

## Status: EM IMPLEMENTAÇÃO

Substitui o `PLANO-CHAT-ATENDIMENTO-V1.md`. A v1 era um bom esboço de escopo, mas não
era implementável com segurança: faltava a regra de visibilidade (o requisito central),
o "assumir" tinha corrida entre atendentes e o modelo de leitura não suportava mais de
um leitor. Este documento corrige e detalha.

---

## 1. Auditoria da v1 — o que estava furado

| # | Falha na v1 | Consequência prática | Correção na v2 |
|---|---|---|---|
| 1 | **Regra de visibilidade ausente.** `GET /admin/atendimentos` era "lista todas" | Todo atendente veria conversa que já é de outro. O requisito ("não atribuída todos veem; atribuída só o dono; dono do sistema vê tudo") não existia no plano | §3 — filtro no SQL, imposto no servidor |
| 2 | **"Assumir" não atômico** | Dois atendentes clicam junto, os dois "ganham"; o segundo UPDATE sobrescreve. Ambos respondem o mesmo cliente | §5.1 — `UPDATE ... WHERE assigned_to IS NULL` + `rowCount` |
| 3 | **`read_at` na mensagem** | Só suporta UM leitor. Com 5 admins, o primeiro que abre zera o badge de todos | §4 — marcadores por LADO (`read_by_client_at` / `read_by_admin_at`) |
| 4 | **Cliente responde em conversa resolvida** — comportamento indefinido | A mensagem cai numa conversa fechada, não aparece na fila de abertos e **ninguém vê**. Cliente ignorado | §5.2 — reabertura automática |
| 5 | **Sem idempotência no envio** | Duplo clique ou retry de rede duplica a mensagem | §5.3 — `client_msg_id` + índice único |
| 6 | **Sem transação** | INSERT da mensagem sem o UPDATE do `last_message_at` → conversa some da ordenação | §5.3 — `BEGIN/COMMIT` |
| 7 | **Sem e-mail** (estava só em "v2 futuro") | Requisito atual: avisar admin e cliente por e-mail em nova mensagem | §6 |
| 8 | **Cliente não podia encerrar** | Requisito atual: o próprio cliente marca como finalizada | §5.4 |
| 9 | `sender_id NOT NULL` com `sender_type='system'` | Mensagem de sistema não tem autor → INSERT falha | §4 — nullable |
| 10 | Paginação "cursor" não especificada | `ORDER BY created_at` empata em timestamps iguais e pagina errado | §4 — desempate por `(created_at, id)` |
| 11 | FK sem `ON DELETE` | Admin removido deixa `assigned_to` órfão | §4 — `ON DELETE SET NULL` |
| 12 | Sem limites de tamanho / rate | Mensagem de 5 MB, flood | §7 |

---

## 2. Princípio que guia o resto

> **A regra vale no servidor, nunca só na tela.** Esconder um botão no React não impede
> um `curl`. Toda visibilidade e toda transição de estado são decididas no SQL/rota.

---

## 3. Regra de visibilidade (o coração do módulo)

Três papéis:

- **Cliente** — vê **apenas** as conversas da própria empresa (`company_id` do JWT).
- **Atendente** (admin com área `atendimento`) — vê:
  - conversas **sem dono** (`assigned_to IS NULL`) → a fila comum; e
  - conversas **próprias** (`assigned_to = eu`).
  - **Não vê** conversa assumida por outro.
- **Dono do sistema** (`is_owner`) — vê **tudo**, sempre. Já é o padrão do
  `adminAreas.js`; aqui só se aplica o mesmo princípio.

Expressão única, aplicada em TODA consulta e em TODA ação de admin:

```sql
-- $1 = admin.id, $2 = is_owner (bool)
($2 IS TRUE OR c.assigned_to IS NULL OR c.assigned_to = $1)
```

Vale também para `GET /:id/messages` e para o PATCH: um id adivinhado não pode abrir a
conversa de outro atendente. Resposta para conversa fora do escopo = **404** (não 403 —
403 confirmaria que o id existe).

---

## 4. Modelo de dados (corrigido)

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'aberto'
         CHECK (status IN ('aberto','em_atendimento','resolvido')),
  assigned_to UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,                    -- 'cliente' | 'admin' (quem encerrou)
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Marcadores de leitura POR LADO. Um `read_at` por mensagem não serve:
  -- há N atendentes e 1 cliente; o primeiro que lesse zeraria o badge dos outros.
  read_by_client_at TIMESTAMPTZ,
  read_by_admin_at  TIMESTAMPTZ,
  -- Anti-flood do e-mail (§6). SÃO DUAS colunas, não uma `last_email_sent_at`: as
  -- janelas dos dois lados são independentes. Com uma coluna só, o aviso mandado ao
  -- escritório calaria por 15 minutos o aviso que o cliente deveria receber da
  -- resposta — e vice-versa.
  email_avisado_admin_at  TIMESTAMPTZ,
  email_avisado_client_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('client','admin','system')),
  sender_id UUID,                      -- NULL quando system
  sender_name TEXT,                    -- desnormalizado: evita JOIN por balão
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  client_msg_id TEXT,                  -- idempotência (ver §5.3)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Nome da tabela é `chat_messages`, não `messages`** — `messages` é genérico demais num
banco que já tem domínio fiscal; colide com leitura futura de WhatsApp/e-mail.

Índices:

```sql
-- Timeline da conversa e paginação estável (desempate por id).
CREATE INDEX IF NOT EXISTS idx_chat_msgs_conv ON chat_messages(conversation_id, created_at, id);
-- Idempotência: mesma chave do cliente nunca insere duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS ux_chat_msgs_idem
  ON chat_messages(conversation_id, client_msg_id) WHERE client_msg_id IS NOT NULL;
-- Fila do atendente: não-atribuídas mais antigas primeiro.
CREATE INDEX IF NOT EXISTS idx_conv_fila ON conversations(status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_assigned ON conversations(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conv_company ON conversations(company_id, last_message_at DESC);
```

---

## 5. Transições de estado (à prova de corrida)

### 5.1 Assumir — atômico

```sql
UPDATE conversations
   SET assigned_to = $1, status = 'em_atendimento'
 WHERE id = $2 AND assigned_to IS NULL
```
`rowCount === 0` → **409 Conflict**: *"Outro atendente assumiu esta conversa."* Sem o
`WHERE assigned_to IS NULL` os dois cliques vencem e o cliente recebe resposta dupla.

**Transferir** também é condicional (`WHERE assigned_to = $eu OR $isOwner`) e grava
mensagem `system`: *"Atendimento transferido de X para Y"*.

### 5.2 Reabertura automática

Cliente escreve em conversa `resolvido` → volta para `aberto`, `assigned_to = NULL`,
`resolved_at = NULL`. Sem isso a mensagem entra numa conversa fechada, **não aparece na
fila** e o cliente fica sem resposta — o pior defeito possível num canal de atendimento.

> Volta para a fila (sem dono) de propósito: quem atendeu antes pode estar de férias.

### 5.3 Enviar mensagem — transação + idempotência

SQL exato (implementado em `chatCore.inserirMensagem`), para não sobrar interpretação:

```sql
BEGIN;

-- 1) A mensagem. O ON CONFLICT usa o índice único PARCIAL; sem a cláusula WHERE o
--    Postgres não consegue inferir o índice e o INSERT falha.
INSERT INTO chat_messages
  (conversation_id, sender_type, sender_id, sender_name, body, client_msg_id)
VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6)
ON CONFLICT (conversation_id, client_msg_id)
  WHERE client_msg_id IS NOT NULL DO NOTHING
RETURNING *;
-- Zero linhas = repetição já conhecida: devolve a original e NÃO segue para o passo 2
-- (senão um duplo clique reabriria a conversa e zeraria leitura sem mensagem nova).

-- 2) A conversa. $2 = "quem escreveu foi o cliente?" (controla a reabertura).
--    `zeraLeitura` é read_by_admin_at quando escreve o cliente, e read_by_client_at
--    quando escreve o escritório — sempre o marcador de QUEM VAI RECEBER.
UPDATE conversations
   SET last_message_at = now(),
       <zeraLeitura> = NULL,
       status      = CASE WHEN $2 AND status = 'resolvido' THEN 'aberto' ELSE status END,
       assigned_to = CASE WHEN $2 AND status = 'resolvido' THEN NULL   ELSE assigned_to END,
       resolved_at = CASE WHEN $2 AND status = 'resolvido' THEN NULL   ELSE resolved_at END,
       resolved_by = CASE WHEN $2 AND status = 'resolvido' THEN NULL   ELSE resolved_by END
 WHERE id = $1::uuid;

COMMIT;
```

> Os quatro `CASE` leem o `status` **antes** do próprio UPDATE (Postgres avalia a linha
> original), então a reabertura é decidida pelo estado em que a conversa estava — e não
> pelo que a mesma instrução acabou de gravar.
O front manda `client_msg_id` (UUID gerado no clique). Duplo clique/retry cai no
`ON CONFLICT` e devolve a mensagem já gravada, em vez de duplicar o balão.

### 5.4 Encerrar

- **Admin resolve:** `status='resolvido'`, `resolved_by='admin'`.
- **Cliente resolve:** mesma coisa com `resolved_by='cliente'` — só na **própria**
  conversa. Mensagem `system`: *"Atendimento encerrado pelo cliente."*
- Reabrir: qualquer nova mensagem do cliente (§5.2) ou ação do admin.

---

## 6. Notificação por e-mail

Reaproveita `api/src/mailer.js` (SMTP já configurado; hoje só serve backup e reset).

| Evento | Destinatário |
|---|---|
| Cliente manda mensagem | atendente **dono**; se ainda **sem dono**, ver a regra da fila abaixo |
| Admin responde | e-mail da empresa |

**Conversa sem dono → um endereço da equipe, não a lista de todos.** Definindo
`CHAT_EMAIL_EQUIPE` (ex.: `atendimento@nescon...`), a fila avisa **esse** endereço e
quem estiver livre pega. Dez atendentes recebendo dez cópias do mesmo assunto produz o
efeito contrário do desejado: cada um supõe que outro vai responder, e a caixa de
entrada deixa de significar alguma coisa. Sem a variável, cai no comportamento antigo —
**uma** mensagem endereçada a todos os atendentes (nunca uma mensagem por pessoa).

Regras de robustez:
- **Nunca bloqueia a resposta HTTP.** O envio vai depois do `COMMIT`, em `setImmediate`,
  com `try/catch` — SMTP fora **não** pode derrubar o chat.
- **Anti-flood:** no máximo 1 e-mail por conversa a cada 15 min (a conversa guarda o
  último aviso). Sem isso, uma conversa animada vira 40 e-mails.
- **Respeita a marcação do escritório** (mesma regra dos alertas) e não manda e-mail para
  quem está com o canal desligado.
- **Escapar HTML do corpo** no template — o React escapa sozinho, o e-mail não.
- Se `isSmtpConfigured()` for falso, apenas loga e segue.

---

## 7. Limites e validação (anti-abuso)

- `body`: 1–4000 caracteres, `trim`, rejeita vazio (**400**).
- `subject`: até 120 caracteres.
- Rate: máx. 20 mensagens/min por empresa (**429**).
- Toda entrada de id validada como UUID (`validateUUID`, middleware já existente).
- Paginação: 50 por página, cursor `(created_at, id)`.
- Nada de HTML no corpo: texto puro, renderizado com quebra de linha.

---

## 8. Endpoints

### Cliente (JWT da empresa)
| Método | Rota | Notas |
|---|---|---|
| GET | `/api/chat/conversations` | só da própria empresa |
| POST | `/api/chat/conversations` | `{subject?, body}` — cria já com a 1ª mensagem |
| GET | `/api/chat/conversations/:id/messages` | 404 se não for da empresa |
| POST | `/api/chat/conversations/:id/messages` | `{body, client_msg_id}` |
| POST | `/api/chat/conversations/:id/read` | marca `read_by_client_at` |
| POST | `/api/chat/conversations/:id/resolver` | encerra (cliente) |
| GET | `/api/chat/unread` | badge |

### Admin (`requireArea('atendimento')`)
| Método | Rota | Notas |
|---|---|---|
| GET | `/api/admin/atendimentos` | **filtro de visibilidade §3** |
| GET | `/api/admin/atendimentos/summary` | contadores do escopo visível |
| GET | `/api/admin/atendimentos/:id/messages` | 404 fora do escopo |
| POST | `/api/admin/atendimentos/:id/messages` | exige ser o dono (ou owner) |
| PATCH | `/api/admin/atendimentos/:id` | `assumir` \| `transferir` \| `resolver` \| `reabrir` |
| POST | `/api/admin/atendimentos/:id/read` | marca `read_by_admin_at` **só se `assigned_to = eu`** (ver §11) |

---

## 11. Leitura do lado do escritório — só o dono carimba

`read_by_admin_at` é uma marca por LADO, e o lado do escritório tem várias pessoas.
Se qualquer atendente pudesse carimbá-la, bastaria um deles **espiar** uma conversa da
fila para o "não lidas" sumir do painel de todos — e a mensagem ficaria sem resposta
justamente por ter sido vista.

```sql
UPDATE conversations SET read_by_admin_at = now()
 WHERE id = $1::uuid AND assigned_to = $2::uuid   -- só o dono
```

Consequência desejada: **enquanto ninguém assume, a conversa continua "não lida" para
todo mundo.** A fila só apaga quando alguém a toma para si. Abrir para olhar (inclusive
o dono do sistema abrindo a conversa de um colega) é leitura legítima e não carimba
marcador nenhum — a rota responde `{ ok: true, marcada: false }`.

---

## 12. Atualização da tela (tempo real)

**Polling, não WebSocket.** O volume é de ~60 empresas e ~5 atendentes; WebSocket
traria sticky session e pub/sub para um ganho que ninguém perceberia.

| Onde | Intervalo | Observação |
|---|---|---|
| Fio da conversa aberta | **5 s** | React Query `refetchInterval` |
| Lista/fila de atendimentos | **15 s** | e ao voltar o foco da aba |
| Badge de não lidas (menu) | **60 s** | consulta barata, tolera atraso |

Regras: `refetchOnWindowFocus: true`; parar o polling com a aba oculta
(`document.hidden`) para não bater no servidor com dez abas esquecidas; o envio faz
refetch imediato, sem esperar o ciclo.

---

## 9. Ordem de implementação

1. `ensureChatSchema.js` — tabelas + índices (idempotente) ✅
2. `chatCore.js` — regras puras e SQL compartilhado (visibilidade, transições)
3. `routes/chat.js` (cliente) → `routes/adminChat.js` (admin)
4. `chatEmail.js` — notificação (não-bloqueante)
5. Integrações: `index.js`, `adminAreas`, `companyTools`
6. Front cliente → front admin
7. Verificação (§10)

## 10. Verificação obrigatória

- [ ] Dois "assumir" simultâneos: um 200, outro **409** (não os dois 200)
- [ ] Atendente B **não** enxerga conversa assumida por A (nem via id direto → 404)
- [ ] `is_owner` enxerga tudo
- [ ] Cliente responde em conversa resolvida → **reabre e volta para a fila**
- [ ] Mesmo `client_msg_id` 2× → **uma** mensagem
- [ ] SMTP fora → mensagem grava normalmente (só loga)
- [ ] Cliente A não acessa conversa da empresa B (404)
- [ ] body vazio/5000 chars → 400
