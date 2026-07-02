# Queijeiros (RH / documentos)

Frontend React (Vite) + API Express + PostgreSQL. O front chama a API em `/api` (proxy Nginx) ou em `VITE_API_URL` quando o build aponta para outro domínio.

## O que o projeto diz hoje sobre deploy

- **`docker-compose.yml`**: sobe `postgres`, `api` (porta interna 3001) e **`web`** (Nginx na **80**, com proxy `/api` → `api:3001`).
- **`Dockerfile` (raiz)**: só constrói o **frontend** estático + Nginx — útil isoladamente, mas **não** inclui API nem banco.
- **Variáveis**: copia `.env.example` para `.env` em local (não commitar) ou define as mesmas chaves no Easypanel.

Para produção na VPS com os três serviços, o caminho alinhado ao repo é **Docker Compose na raiz**, não só o `Dockerfile` da raiz.

**Repositório:** `https://github.com/contabilidade-01/queijeiros`  
**Pasta local (GitHub Desktop):** `C:\Users\Jeandson\Documents\GitHub\queijeiros`  
**Push:** feito pelo **GitHub Desktop** (HTTPS — autenticação gerida pelo app)

### Checklist rápido (Easypanel na VPS)

1. Novo **projeto** → serviço **Docker Compose** → fonte **Git**, branch `main`, raiz do repo (ficheiro `docker-compose.yml` no topo).
2. Variáveis de ambiente: `DB_PASSWORD`, `JWT_SECRET` (obrigatórias em produção); `VITE_API_URL` vazio se usares o Nginx do stack (proxy interno `/api`).
3. Garantir volumes persistentes para **`pgdata`** e **`uploads`** (o painel mapeia para disco do servidor).
4. **Domínio** (ex.: `app.gestaoempresa.com`): DNS com registo **A** para o IP da VPS; no Easypanel em **Serviço Compose** usa **`web`** (Nginx) e **porta 80**, e ativa **HTTPS**.
5. **Auto Deploy**: nas definições da fonte Git no Easypanel, ativar para redeploy a cada push (webhook no GitHub).

### Postgres `rhapp` vs `DB_PASSWORD` (Erro "password authentication failed")

Se mudares `DB_PASSWORD` no painel **depois** do volume `pgdata` já existir, o utilizador `rhapp` no Postgres **mantém a palavra-passe antiga**. A API passa a falhar (`/api/health` com `database: "down"`).

**Opção rápida:** na consola do contentor **postgres**, executa o SQL em **`db/fix-rhapp-password.sql`** (altera `ALTER USER` para a mesma string que `DB_PASSWORD`). **Ou** apaga o volume `pgdata` e volta a implantar (perdes dados dessa BD; o `db/init.sql` corre outra vez).

### Login inicial (após `init.sql`)

Regra: login = **CNPJ** (com ou sem máscara); senha inicial = **14 dígitos do CNPJ**. **Troque a senha após o primeiro login.** As empresas seed estão em `db/init.sql`; credenciais ficam em anotações locais, fora do repositório.

### Queijeiro 4 (Q4) — suspensão e advertência

Login da Q4: CNPJ da empresa (ver `db/init.sql`); senha inicial segue a regra acima.

**Qual fonte é mais completa?**

| Fonte | O que tem |
|-------|-----------|
| `db/init.sql` | Empresa Q4 + admin (instalação nova) |
| `db/seed-queijeiros-companies.sql` | Só cadastro Q3/Q4 (BD já existente) |
| `db/seed-queijeiros-q4-employees.sql` | **15 funcionários** da planilha (melhor para RH) |
| Planilha `RELAÇÃO DE EMPREGADOS.xls` | Mesmos 15 funcionários — importar na UI |

Para emitir suspensão/advertência: cadastre os funcionários (seed SQL **ou** importação de planilha), faça login no CNPJ da Q4 e use **Suspensão** / **Advertência**.

**Pelo painel admin (`/admin`):**

1. Botão **Cadastrar Q3 + Q4 (seed)** — cria as empresas Queijeiro se ainda não existirem
2. Em **Filtrar listas por empresa**, escolha **Queijeiro 4**
3. Em **Gestão de empresas** → **Importar funcionários (planilha)** — suba o `.xls` / `.xlsx`

```bash
# Opcional: funcionários Q4 direto no Postgres
docker compose exec -T postgres psql -U rhapp -d rhapp < db/seed-queijeiros-q4-employees.sql
```

### Administrador global

Login = **CPF** do administrador (com ou sem máscara); a senha inicial está nas anotações locais de acessos (fora do repositório). **Troque-a após o primeiro login.**

Acesso ao painel `/admin` (todas as empresas). Na primeira subida da API, a tabela `platform_admins` é criada automaticamente. Script manual: **`db/seed-platform-admin.sql`**.

### Recuperação de senha por e-mail

- No login, **Esqueci minha senha** pede CNPJ ou CPF + e-mail. Só envia o link se o e-mail for **igual** ao cadastrado para essa empresa ou administrador.
- Cadastro de e-mail: no painel **`/admin`**, o administrador define o próprio e-mail e, por empresa, o e-mail de recuperação (lista de empresas).
- Variáveis na **API** (senão a rota responde 503 para “esqueci a senha”):

| Variável | Exemplo / notas |
|----------|------------------|
| `PUBLIC_APP_URL` | `https://app.seudominio.com` — URL base do **front** onde abre `/reset-password` (sem barra final). |
| `SMTP_HOST` | `smtp.seuprovider.com` |
| `SMTP_PORT` | `587` (STARTTLS) ou `465` (SSL) |
| `SMTP_SECURE` | `true` se a porta for 465; caso contrário `false` |
| `SMTP_USER` / `SMTP_PASS` | Credenciais SMTP |
| `SMTP_FROM` | Remetente, ex. `Gestão <no-reply@seudominio.com>` |
| `PASSWORD_RESET_EXPIRY_MINUTES` | Opcional; padrão `60` (mín. 5, máx. 7 dias). |
| `RATE_LIMIT_FORGOT_PASSWORD_MAX` | Opcional; padrão `5` pedidos / 15 min por IP. |
| `RATE_LIMIT_RESET_PASSWORD_MAX` | Opcional; padrão `20` / 15 min por IP. |
| `TRUST_PROXY_HOPS` | Opcional; padrão `1` — hops de proxy confiáveis para o rate limit ver o IP real. |

O token no e-mail é armazenado só como **hash** na tabela `password_reset_tokens` e expira; uso único após redefinir.

### Várias empresas (CNPJ) e “banco por cliente”

- No painel **`/admin`** podes **cadastrar novas empresas** (CNPJ, nome, e-mail e telefone). A **senha inicial** é sempre os **14 dígitos do CNPJ** (como nos seeds).
- **Acesso exclusivo:** com login de **empresa** (CNPJ), a API só devolve dados com o `company_id` dessa empresa — a mesma **interface** (portal) serve todos os CNPJ; o isolamento é **lógico** na mesma base PostgreSQL (`rhapp`), não um ficheiro/instância Postgres separada por CNPJ. Criar **uma base de dados física por cliente** exigiria utilizador com `CREATEDB`, gestão de dezenas de conexões e migrações por base; não é o modelo actual.
- No admin, o filtro **“Filtrar listas por empresa”** restringe documentos, funcionários e atestados à empresa escolhida.

### Consola do Chrome no login

Mensagens do tipo *"The message channel closed before a response was received"* costumam vir de **extensões do navegador** (tradutor, bloqueador, etc.), não da aplicação. Teste numa janela anónima sem extensões ou ignore se o login e a API funcionam.

Se a BD já tinha sido criada antes deste seed, corre também **`db/seed-queijeiros-companies.sql`** uma vez no Postgres:

```bash
docker compose exec -T postgres psql -U rhapp -d rhapp < db/seed-queijeiros-companies.sql
```

### Importação de funcionários (planilha)

Na tela **Funcionários**, use o botão **Importar planilha**:

- Aceita **CSV**, **.xls** e **.xlsx** (formato "Relação de Empregados").
- O sistema lê `Nome` + `CPF` de arquivos com `;` ou colunas equivalentes no Excel.
- Linhas com **data de demissão** preenchida **não são importadas** (demitidos ficam de fora).
- Se o CPF já existir na mesma empresa, a linha é ignorada (evita duplicados).

Funcionários **inativos** (`active = false`) são **removidos automaticamente** sempre que o contentor da **API** inicia (cada redeploy no Easypanel). O ficheiro `db/delete-inactive-employees.sql` serve só se quiser correr o mesmo `DELETE` manualmente no Postgres.

---

## Deploy no Easypanel

Documentação oficial útil: [App Service](https://easypanel.io/docs/services/app), [GitHub / tokens e webhooks](https://easypanel.io/docs/code-sources/github).

### Opção recomendada: serviço **Compose**

1. Criar **projeto** no Easypanel → adicionar serviço do tipo **Docker Compose** (ou equivalente que aplique o `docker-compose.yml` do repositório).
2. **Fonte**: repositório Git (SSH ou GitHub), **branch** correta, **caminho** na raiz onde está o `docker-compose.yml`.
3. **Domínio / proxy**: apontar para o serviço **`web`** na **porta 80** (Nginx: SPA + proxy `/api`).
4. **Volumes persistentes** (importante no Easypanel): mapear volumes nomeados para não perder dados ao redeploy:
   - `pgdata` — base PostgreSQL  
   - `uploads` — ficheiros enviados pela API (certificados, etc.)
5. **Variáveis de ambiente** (no Compose ou no painel, conforme o Easypanel injectar no `.env` do compose):

| Variável | Onde | Notas |
|----------|------|--------|
| `DB_PASSWORD` | compose | Palavra-passe do Postgres (`POSTGRES_PASSWORD` / API). |
| `JWT_SECRET` | compose | Segredo forte em produção. |
| `VITE_API_URL` | build do serviço `web` | Deixar vazio se front e API ficam no mesmo host com proxy `/api`. Se o front for servido noutro domínio, usar URL absoluta da API, ex.: `https://api.teudominio.com/api`. |
| `PUBLIC_APP_URL` | serviço `api` | URL pública do **site** (front), ex. `https://app.teudominio.com`, para links de recuperação de senha. |
| `SMTP_*` | serviço `api` | Ver secção **Recuperação de senha por e-mail** acima. |

6. **SSH / clone**: repositório privado requer chave ou token configurado no Easypanel (no passado, URL/branch vazios ou clone incompleto geram erros tipo “api not found”).

### Opção alternativa: três **Apps** separados

Possível, mas exige reproduzir rede, variáveis e proxy manualmente (Postgres como serviço de base de dados do Easypanel, API com `DB_HOST` apontando para esse serviço, front com Nginx a apontar para o hostname interno da API). O **`docker-compose.yml`** já modela isso; por isso o Compose costuma ser mais simples.

---

## Deploy automático — opções

1. **Auto Deploy (Easypanel + GitHub)**  
   Nos definições do serviço (origem Git), ativar **Auto Deploy**. O Easypanel regista um **webhook** no GitHub: cada **push** na branch configurada dispara build e deploy.  
   - Token GitHub: para webhooks automáticos, o token precisa de permissão de **Webhooks** (fine-grained) ou `admin:repo_hook` (classic). Ver [documentação GitHub do Easypanel](https://easypanel.io/docs/code-sources/github).

2. **Deploy Webhook (URL manual)**  
   Cada app/serviço pode ter uma **URL de deploy** que, quando chamada (ex.: `curl`), inicia um novo deploy. Útil para integrações, bots ou pipelines externos.

3. **GitHub Actions → webhook do Easypanel**  
   Workflow opcional `.github/workflows/trigger-easypanel-deploy.yml`: em cada push em `main`, faz `POST` para a URL do **Deploy Webhook** do Easypanel. Cria o secret `EASYPANEL_DEPLOY_WEBHOOK` no repositório GitHub com essa URL; se o secret não existir, o job ignora (não falha). Útil se preferires disparar o painel a partir do GitHub em vez (ou além) do webhook direto GitHub↔Easypanel.

4. **Notificações**  
   O Easypanel pode avisar (Discord, Slack, Telegram, e-mail) quando um deploy termina, entre outros eventos — ver [Notifications](https://easypanel.io/docs/guides/notifications).

---

## Desenvolvimento local

- Frontend: `npm install` && `npm run dev` (porta padrão do Vite no `vite.config.ts`).
- API com Postgres: `docker compose up` na raiz, ou API à parte com `VITE_API_URL=http://localhost:3001/api` no `.env` do front.

---

## Testes e lint

```bash
npm run build
npm run lint
npm test
```
