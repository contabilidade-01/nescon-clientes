# PLANO — Sub-usuários do Cliente (o cliente vira admin da própria conta)

> Status: **plano aprovado para execução no próximo turno.** Nada implementado ainda.
> Escrito em 2026-08-14.

## 1. Objetivo

Hoje cada empresa tem **um único login** (CNPJ + senha). Queremos que a própria
empresa (o login principal, "proprietário") possa **criar sub-usuários** — tipicamente
gerentes/RH — com **CPF + e-mail + senha próprios**, e dar a cada um acesso **só ao que
ele precisa**:

- **Advertência** (gerar documento de advertência)
- **Suspensão** (gerar documento de suspensão)
- **Atestados** (enviar fotos de atestado médico)
- **Falta sem atestado** (NOVO — registrar indicação de falta injustificada)

Com: geração de senha do sub-usuário, recuperação de senha do sub-usuário, ativar/
desativar, e permissões marcáveis por sub-usuário.

## 2. Estado atual (o que já existe e vamos reaproveitar)

| Peça | Arquivo | Observação |
|---|---|---|
| Login (CNPJ/CPF/CPF-admin) | `api/src/routes/auth.js` (`/login`, l.235) | CPF 11 díg. → tenta admin, depois empresa. É aqui que o sub-usuário entra. |
| JWT empresa / admin | `api/src/middleware/auth.js` | `generateToken` (empresa), `generateAdminToken` (admin). Adicionar 3º papel. |
| Permissões da empresa | `api/src/companyTools.js` | `tool_access` já tem `warning`, `suspension`, `certificates`, `employees`. |
| Permissões do admin (padrão a espelhar) | `api/src/adminAreas.js` + `platform_admins.areas` | Modelo de "áreas por usuário" — copiar a ideia para o sub-usuário. |
| Troca de senha inicial | `middleware/auth.js` (`blockUntilPasswordChanged`) | Reusar para o sub-usuário. |
| Recuperação de senha | `auth.js` (`/forgot-password`, `/reset-token`, `/reset-password`) + `password_reset_tokens` | Estender para casar sub-usuário por CPF/e-mail. |
| Advertência | `src/components/WarningForm.tsx` → `api.documents.create({document_type:"warning"})` | Gate por permissão `warning`. |
| Suspensão | `src/components/SuspensionForm.tsx` (verificar rota no turno) | Gate por permissão `suspension`. |
| **Atestados = fotos** | `src/pages/CertificatesPage.tsx` → `api.certificates` (upload câmera/arquivo) | `certificates` no `tool_access` **é atestado médico**. Gate por `certificates`. |
| Sessão no front | `src/hooks/useAuth.ts` (`CompanySession`/`AdminSession`) | Adicionar `CompanyUserSession`. |
| Cadastro de acesso (padrão de senha) | `api/src/senhaInicial.js`, rota `enviar-acesso` (admin.js) | Reusar `gerarSenhaInicial()` para o sub-usuário. |

**Login hoje:** CPF (11) primeiro procura em `platform_admins`; não achando, cai no login
de empresa (que consulta `companies.cnpj`). O CPF de um sub-usuário não bate com nenhum
CNPJ → precisamos de uma consulta nova a uma tabela de sub-usuários.

## 3. Modelo de dados (novas tabelas)

### 3.1 `company_users` — os sub-usuários
Arquivo novo: `api/src/ensureCompanyUsersSchema.js` (padrão dos outros `ensure*`), plugado
no boot em `api/src/index.js`.

```sql
CREATE TABLE IF NOT EXISTS company_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cpf TEXT NOT NULL,                 -- 11 dígitos, só números
  nome TEXT NOT NULL,
  email TEXT,                        -- necessário p/ recuperação de senha self-service
  password_hash TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  password_expires_at TIMESTAMPTZ,   -- senha temporária de 30 dias (mesmo padrão da empresa)
  active BOOLEAN NOT NULL DEFAULT true,
  -- Permissões DELEGADAS: subconjunto do que a empresa pode. JSONB de flags.
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_por UUID,                   -- company_id ou company_user que criou (auditoria)
  ultimo_login_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- CPF único no sistema inteiro de sub-usuários (login por CPF):
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_users_cpf ON company_users(cpf);
CREATE INDEX IF NOT EXISTS idx_company_users_company ON company_users(company_id);
```

**Chaves de `permissions`** (subconjunto delegável — NÃO tudo do `tool_access`):
`warning`, `suspension`, `certificates`, `falta`. (Leitura de funcionários é implícita —
todas as ações precisam escolher um funcionário.)

**Invariante:** `permissions[k] === true` só é válido se o **`tool_access[k]` da empresa**
também for true. Se o escritório desligou `warning` para a empresa, ela não pode delegar
`warning`. Validar no create/update.

### 3.2 `employee_absences` — falta sem atestado (NOVO)
Arquivo novo: `api/src/ensureAbsencesSchema.js`.

```sql
CREATE TABLE IF NOT EXISTS employee_absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  employee_cpf TEXT,                 -- redundância p/ sobreviver a troca de cadastro
  employee_nome TEXT,
  data_falta DATE NOT NULL,          -- uma linha por dia de falta
  tipo TEXT NOT NULL DEFAULT 'sem_atestado',
  observacao TEXT,
  registrado_por_tipo TEXT,          -- 'company' | 'company_user'
  registrado_por_id UUID,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_absences_company_data ON employee_absences(company_id, data_falta DESC);
```
Objetivo: dá ao escritório o insumo para **desconto de falta / DSR** na folha. Guardar +
listar já resolve o cliente; a visão do escritório pode ser fase 2 (ver §7).

## 4. Backend

### 4.1 Autenticação — 3º papel `company_user`
- `middleware/auth.js`:
  - `generateCompanyUserToken({ id, company_id, company_name, company_cnpj, cpf })` →
    JWT `{ role: "company_user", company_user_id, company_id, ... }`.
  - Em `authMiddleware`, novo ramo `decoded.company_user_id`:
    - Carrega o sub-usuário da BASE (permissões/ativo lidos a cada request, como o admin).
    - `req.company` = **a empresa-mãe** (para as rotas company-scoped existentes funcionarem).
    - `req.companyUser = { id, cpf, nome, permissions }`.
    - `req.companyToolAccess` = `tool_access da empresa` **∩** permissões do sub-usuário.
    - `req.mustChangePassword` do sub-usuário; reusar `blockUntilPasswordChanged`
      (incluir as rotas livres de sessão do sub-usuário).
- `routes/auth.js` `/login`: depois do check de admin e **antes** do check de empresa,
  consultar `company_users` por CPF (11 díg., ativo). Achou → devolve
  `role: "company_user"` com `{ id, nome, cpf, company_id, company_name, permissions,
  must_change_password }`. Carimbar `ultimo_login_em`.
  - Cuidado de ordem: CPF de `platform_admin` continua tendo prioridade (não deixar um
    sub-usuário sombrear um admin). Validar no create que o CPF não é de admin.

### 4.2 Permissões — middleware novo
`middleware/companyPermission.js`:
- `req.companyPermissions`:
  - login **empresa** (proprietário) → todas as chaves que o `tool_access` liberou (acesso total dentro da empresa);
  - **sub-usuário** → `permissions ∩ tool_access`.
- `requireCompanyPermission(key)` → 403 se a chave não estiver liberada.
- `requireCompanyOwner` → só o login principal da empresa (sub-usuário recebe 403). Usar
  nas rotas de **gestão de sub-usuários** (o sub-usuário não gerencia outros).

### 4.3 Rotas — gestão de sub-usuários (novo `routes/companyUsers.js`)
Todas sob `authMiddleware` + `requireCompanyOwner` (login principal da empresa):
- `GET  /api/company-users` — lista os da própria empresa (nunca de outra).
- `POST /api/company-users` — cria { cpf, nome, email, permissions }. Gera senha temporária
  (`gerarSenhaInicial`), `must_change_password=true`, expira em 30 dias; devolve a senha
  **uma vez**. Valida: CPF válido/único, não é admin, permissões ⊆ tool_access da empresa.
- `PATCH /api/company-users/:id` — nome/e-mail/permissions/active.
- `POST /api/company-users/:id/reset-password` — gera nova senha temporária (mostra uma vez).
- `DELETE /api/company-users/:id` — remove (ou desativa; decidir — soft-delete é mais seguro).
- Opcional: `POST /api/company-users/:id/enviar-acesso` — manda a senha por e-mail
  (reusa `mailer.js`) ou WhatsApp.

### 4.4 Rotas — features delegadas (gate)
- Advertência: rota do `api.documents.create` para `warning` → `requireCompanyPermission("warning")`.
- Suspensão: idem `suspension` (localizar a rota no turno).
- Atestados: rotas de `api.certificates` (upload/list) → `requireCompanyPermission("certificates")`.
- **Falta sem atestado (novo `routes/absences.js`):**
  - `POST /api/absences` { employee_id, datas[], observacao } → `requireCompanyPermission("falta")`.
  - `GET  /api/absences?mes=YYYY-MM` — lista da empresa.
  - (Fase 2) visão no painel do escritório.

### 4.5 Recuperação de senha do sub-usuário
Estender `/forgot-password` e `/reset-password` (auth.js) e a tabela
`password_reset_tokens` (já tem `company_id`; adicionar `company_user_id` com o mesmo
CHECK de alvo único). Casar por CPF **ou** e-mail do sub-usuário; enviar link por e-mail
(`mailer.js`). Sem e-mail cadastrado → recuperação só pelo proprietário (regenerar senha).

## 5. Frontend

### 5.1 Sessão (`src/hooks/useAuth.ts`)
- Novo tipo `CompanyUserSession` (`role: "company_user"`) com `companyUserId`, `company{id,name,cnpj}`, `permissions`, `mustChangePassword`.
- Helpers: `companyUser`, e um `permissions` efetivo (empresa = tudo do tool_access; sub-usuário = interseção). O portal já lê `toolAccess`; o back manda `companyToolAccess` já interseccionado, então o gating de menu continua valendo sem reescrever tudo.

### 5.2 Gestão de acessos (nova página no portal do cliente)
- Rota tipo `/usuarios` (ou "Gestão de Acessos"), visível **só ao login principal** da empresa.
- Lista de sub-usuários + estado (ativo, "senha pendente"), com selo verde/vermelho no
  padrão que já fizemos em Enviar Acesso.
- Modal/criar: CPF (máscara), nome, e-mail, **checkboxes de permissão** (só as chaves que a
  empresa tem no tool_access — as demais aparecem desabilitadas com dica "o escritório não
  liberou").
- Ações: gerar/copiar senha (mostrada uma vez), reenviar por e-mail, resetar senha,
  ativar/desativar, remover.

### 5.3 Falta sem atestado (nova página/aba)
- Form: escolher funcionário (`EmployeeSelect`), 1+ datas (`MultiDateField`), observação
  opcional → `POST /api/absences`. Histórico do mês abaixo.
- Aparece no menu só com permissão `falta`.

### 5.4 API client (`src/lib/api.ts`)
- `api.companyUsers.*` (list/create/update/resetPassword/remove/enviarAcesso).
- `api.absences.*` (create/list).
- `src/lib/companyTools.ts`: definir o conjunto **delegável** (`warning`, `suspension`,
  `certificates`, `falta`) e rótulos PT-BR para os checkboxes.

## 6. Matriz de permissões (resumo)

| Ator | Gerencia sub-usuários | Advertência | Suspensão | Atestados | Falta s/ atestado | Demais (guias, folha, férias…) |
|---|---|---|---|---|---|---|
| Empresa (login principal) | ✅ | conforme tool_access | conforme tool_access | conforme tool_access | ✅ (novo) | conforme tool_access |
| Sub-usuário (gerente) | ❌ | se `permissions.warning` | se `permissions.suspension` | se `permissions.certificates` | se `permissions.falta` | ❌ (não delegável) |
| Escritório (admin) | vê tudo | — | — | — | vê (fase 2) | administra tool_access |

Regra de ouro: **sub-usuário nunca excede a empresa**; **empresa nunca excede o que o
escritório liberou** (`tool_access`).

## 7. Ordem de execução sugerida (fases)

1. **Schemas + boot**: `ensureCompanyUsersSchema`, `ensureAbsencesSchema`, coluna
   `company_user_id` em `password_reset_tokens`. Plugar no `index.js`.
2. **Auth do sub-usuário**: token, ramo no `authMiddleware`, ramo no `/login`,
   `blockUntilPasswordChanged`. Testes de login/permissão.
3. **Middleware de permissão** + gate nas rotas existentes (warning/suspension/certificates).
4. **CRUD `company-users`** (backend) + validações (subset, CPF único/não-admin).
5. **Frontend**: sessão, página de Gestão de Acessos, gating de menu.
6. **Falta sem atestado**: tabela → rota → página. 
7. **Recuperação de senha** do sub-usuário (e-mail) + reset pelo proprietário.
8. **Fase 2 (escritório)**: visão das faltas no painel admin (insumo de folha) e, se quiser,
   um resumo de sub-usuários por empresa.

## 8. Segurança / cuidados

- Permissões e `active` lidos da BASE a cada request (como o admin) — desativar corta na hora.
- `permissions ⊆ tool_access` validado no servidor (não confiar no front).
- CPF do sub-usuário: válido, único, e **não** pertencente a `platform_admins` (senão o
  login sombrearia o admin).
- `must_change_password` + expiração de 30 dias reusando a trava existente.
- Rate limit de login já cobre; adicionar rate limit no reset self-service.
- **LGPD**: CPF+e-mail de sub-usuário é dado pessoal novo — registrar base legal/consentimento
  (ver `lgpd.js`); a empresa é a controladora ao cadastrar seu gerente.
- Auditoria: `criado_por`, `registrado_por_*` preenchidos sempre.
- Todas as consultas continuam **escopadas por `company_id`** (um sub-usuário só enxerga a
  própria empresa) e respeitam arquivada/excluída.

## 9. Decisões a confirmar antes/durante a execução

1. **Remover ou desativar** sub-usuário no DELETE? (Sugiro soft-delete `active=false` +
   opção de excluir definitivo.)
2. **Envio da senha do sub-usuário**: só mostrar na tela (empresa repassa), por e-mail, ou
   também WhatsApp? (Sugiro tela + e-mail; WhatsApp fica opcional.)
3. **Falta sem atestado** gera algum documento, ou é só registro para o escritório?
   (O pedido diz "campo de indicação" → só registro. Documento fica fora do escopo.)
4. **Onde o escritório vê as faltas** — nova telinha no admin, ou dentro da conferência de
   folha? (Sugiro uma lista simples no admin na fase 2.)
5. Um sub-usuário pode ter permissão de **gerenciar outros** sub-usuários? (Sugiro NÃO —
   só o login principal; simplifica e é mais seguro.)
