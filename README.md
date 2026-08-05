# Portal do Cliente — Nescon

Portal onde o cliente da contabilidade acessa tudo que o escritório entrega: guias fiscais,
folha de pagamento, documentos, boletos e um calendário de vencimentos. Os documentos são
puxados automaticamente do G-Click; o sistema de guias (GCLICK) apenas avisa o cliente por
WhatsApp com um link para o portal.

Frontend React (Vite) + API Express + PostgreSQL. O front chama a API em `/api` (proxy Nginx) ou em `VITE_API_URL` quando o build aponta para outro domínio.

> **Retomando o projeto?** Comece por **[docs/ESTADO-E-PROXIMO-PASSO.md](docs/ESTADO-E-PROXIMO-PASSO.md)**
> — estado atual, o que foi feito e o próximo passo detalhado.

## O que o projeto diz hoje sobre deploy

- **`docker-compose.yml`**: sobe `postgres`, `api` (porta interna 3001) e **`web`** (Nginx na **80**, com proxy `/api` → `api:3001`).
- **`Dockerfile` (raiz)**: só constrói o **frontend** estático + Nginx — útil isoladamente, mas **não** inclui API nem banco.
- **Variáveis**: copia `.env.example` para `.env` em local (não commitar) ou define as mesmas chaves no Easypanel.

Para produção na VPS com os três serviços, o caminho alinhado ao repo é **Docker Compose na raiz**, não só o `Dockerfile` da raiz.

**Repositório:** `https://github.com/contabilidade-01/nescon-clientes`  
**Pasta local (GitHub Desktop):** `C:\Users\Jeandson\Documents\GitHub\nescon-clientes`  
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

Regra: login = **CNPJ** (com ou sem máscara); senha inicial = **14 dígitos do CNPJ**. **Troque a senha após o primeiro login.** As empresas dos clientes são criadas automaticamente pela sincronização com o G-Click; só o admin e a empresa operacional da contabilidade ficam no seed de `db/init.sql`.

### Funcionários

Cadastro por importação de planilha (**Importar funcionários** no painel admin — há um modelo
para baixar) ou automaticamente lendo o **extrato de folha** já hospedado no portal (botão
**Ler extrato** no painel admin, por empresa ou em massa).

### Administrador global

Login = **CPF** do administrador (com ou sem máscara); a senha inicial está nas anotações locais de acessos (fora do repositório). **Troque-a após o primeiro login.**

Acesso ao painel `/admin` (todas as empresas). Na primeira subida da API, a tabela `platform_admins` é criada automaticamente. Script manual: **`db/seed-platform-admin.sql`**.

## Painel do escritório: uma página por área

> Passo a passo de deploy, validação e cadastro inicial deste módulo:
> **[docs/PROXIMOS-PASSOS.md](docs/PROXIMOS-PASSOS.md)**.

O `/admin` é dividido por segmento de trabalho, com **menu lateral que retrai** (botão no topo ou
`Ctrl`/`Cmd` + `B`; no celular vira gaveta). O layout está em `src/components/admin/AdminLayout.tsx`
e cada rota é uma página em `src/pages/admin/`:

| Rota | O que faz |
|------|-----------|
| `/admin` | Visão geral: números do escritório, licenças que exigem atenção e consentimentos LGPD. Cada cartão leva à área correspondente. |
| `/admin/empresas` | Cadastro de CNPJ, razão social, contactos, permissões por ferramenta e importações da empresa. |
| `/admin/funcionarios` | Quadro de pessoal, cadastro em massa pelo extrato e **avisos de saída da folha**. |
| `/admin/entregas` | Entregas por empresa (liberadas × retidas), documentos de DP e atestados. |
| `/admin/licencas` | Licenças e marcação estabelecida × não estabelecida (ver abaixo). |
| `/admin/taxas-anuais` | Controle das guias de taxa anual da prefeitura. |
| `/admin/lgpd` | Auditoria dos consentimentos e o texto do termo em vigor. |
| `/admin/sincronizacao` | Sincronização com o G-Click e e-mail do administrador. |
| `/admin/usuarios` | **Só o dono** — usuários do painel e o que cada um pode ver. |
| `/admin/clientes-gclick` | **Só o dono** — clientes novos vindos do G-Click, mudanças de situação e rejeitados. |
| `/admin/envio-guias` | Iframe do sistema GCLICK (app separado). |

### Usuários do painel e acesso por área

O administrador deixou de ser tudo-ou-nada. Existem dois papéis:

- **Dono** (`is_owner`): vê todas as áreas e é o **único** que cria e edita usuários. As permissões
  dele não são editáveis — senão daria para se trancar para fora.
- **Usuário**: entra por **CPF** e vê só as áreas que o dono marcar. Nasce **sem nenhuma**.

Gerido em **`/admin/usuarios`** (só o dono enxerga o item no menu). Ao criar, o sistema **gera a
senha inicial e mostra uma única vez** — anote e passe por canal seguro; a pessoa é obrigada a
trocá-la no primeiro acesso. Também dá para desativar um acesso (o login passa a ser recusado) e
redefinir a senha.

**A trava é no servidor, não no menu.** Esconder o item da barra lateral é conforto; quem impede o
acesso aos dados é `requireArea()` em `api/src/middleware/adminArea.js`, aplicado rota a rota — o
menu escondido sozinho seria contornável chamando a API direto. As permissões são lidas do banco a
cada requisição, então tirar o acesso de alguém tem efeito imediato, sem esperar o token expirar.

Áreas disponíveis: `empresas`, `funcionarios`, `entregas`, `licencas`, `taxas_anuais`, `lgpd`,
`sincronizacao`, `envio_guias` (lista em `api/src/adminAreas.js`, espelhada em
`src/lib/adminAreas.ts` — ao acrescentar uma, mexer nos dois e no menu). A **visão geral** é a porta
de entrada e todo usuário vê; ela mostra só os números das áreas que a pessoa tem.

Compatibilidade: `areas` **nulo** = acesso total. Os logins que já existiam continuam funcionando
sem migração, e o CPF do seed vira **dono** no primeiro arranque.

### Clientes vindos do G-Click

O G-Click descobre; **a decisão de cadastrar é do escritório**. Um espelho (`gclick_clients`) guarda
a cópia crua do que existe lá, junto da decisão (pendente / aceito / rejeitado), e uma fila
(`gclick_pendencias`) junta os alertas. A sincronização **nunca** escreve em `companies` nem mexe na
decisão.

- **Cliente novo** → alerta com opção de cadastrar ou recusar. Recusado vai para *Rejeitados* e não
  volta a ser perguntado enquanto nada mudar; se for reativado no G-Click, o sistema repergunta.
- **Mudança de situação** (ATIVO ↔ DESATIVADO) → aviso informativo com *OK, ciente*. **Não** bloqueia
  o acesso do cliente ao portal; rende apenas o selo "inativo no G-Click" no cadastro.
- O alerta aparece em três lugares: faixa no topo da visão geral, número no menu lateral e um aviso
  ao abrir o painel (uma vez por sessão).
- **Tudo isto é exclusivo do dono.** Decidir quem entra no portal é decisão de dono, não de
  operador: os demais usuários do painel não veem o item no menu, não recebem o alerta e a API
  responde 403 para eles. Não há área liberável para isso — é o mesmo critério de
  `/admin/usuarios`.

**Atenção — a criação automática continua ligada.** A sincronização de documentos ainda cria a
empresa sozinha quando chega uma guia de CNPJ desconhecido. Consequência: o botão *não cadastrar*
**não remove** um cadastro que já existe; a tela avisa isso quando é o caso. A lista de novos vale
como aviso, não como porteiro. Desligar isso era a Fase 4 do plano, que ficou fora de escopo.

O espelho sempre traz **todos** os clientes, inclusive os desativados — sem eles não haveria como
perceber que alguém foi desativado. O switch *"alertar só sobre clientes ativos"*
(`/admin/sincronizacao`, gravado em `app_settings`; `GCLICK_ALERTA_SO_ATIVOS` é o padrão) decide
apenas **quem vira alerta**.

### Férias (previsão, custo e limite de faltas)

**A seção só aparece para quem tem funcionário celetista.** Empresa que só tem pró-labore não
tem férias a programar, e um menu vazio parece serviço faltando. A regra vive em
`api/src/payrollRoles.js` e usa o **cargo** lido do Extrato Mensal (sócio, diretor, titular,
pró-labore). Cargo ainda desconhecido conta como funcionário — errar mostrando é barato,
errar escondendo faz o cliente achar que perdeu um serviço.


Seção **Férias** no portal do cliente (chave `vacations` em `tool_access`), alimentada pela
**Programação de Férias** do G-Click — o PDF é importado em `/admin/empresas`, na ficha da
empresa, porque o G-Click não expõe esse relatório na API.

O que o cliente vê:

- **quem tem direito e quando**, ordenado pelo mais urgente;
- **quanto vai custar**: `salário/30 × dias × 4/3 × 1,08` (férias + 1/3 + FGTS). O FGTS incide
  sobre o valor **já com o terço**. Sem salário na folha mais recente, o custo fica **em
  branco** e o resumo diz quantos ficaram de fora — nunca R$ 0,00;
- **limite de faltas**: *"com 11 faltas, mais 4 e as férias caem de 24 para 18 dias"*.

**Os dias de direito não são recalculados.** O relatório do G-Click já aplica o Art. 130 e nós
usamos o número que veio; refazer a conta arriscaria a tela discordar do documento que o
cliente tem em mãos. A tabela do Art. 130 (`api/src/vacationRules.js`) serve só para dizer
quantas faltas ainda cabem antes de cair de faixa.

No **calendário** aparece o *limite de segurança* — 30 dias antes do prazo legal —, porque
marcar o prazo em si seria avisar quando já não dá para agir.

O cruzamento entre a Programação e a folha é por **código** do funcionário dentro da empresa,
com o nome normalizado como segunda tentativa. O salário vem do Extrato Mensal, lido
automaticamente a cada sincronização (ver abaixo).

### Licenças (funcionamento, AVCB/CLCB, vigilância sanitária)

**A situação de uma licença nunca é gravada.** A base guarda só a **data de vencimento**; ativa,
a vencer, vencida ou ausente é **calculado na leitura** por `api/src/licenseStatus.js` — a mesma
regra em SQL (`statusSql`, usada pelo painel e pela listagem) e em JS (`statusOf`, testada em
`src/test/licenseStatus.test.ts`). Consequência prática: nada envelhece na base, não existe rotina
para "expirar" licença e o resumo nunca discorda da lista.

- **Janela de aviso:** 60 dias antes do vencimento a licença entra em *a vencer*. Muda com a
  variável `LICENSE_WARN_DAYS` na API (1 a 365).
- **Renovação:** cadastre uma **nova** licença do mesmo tipo. A vigente é sempre a de vencimento
  mais distante; as anteriores ficam como histórico.
- **Empresa não estabelecida** (sem ponto físico) não precisa de licença: desmarque em
  *Licenças → Empresas estabelecidas* e ela sai do painel de licenças **e** do controle de taxa
  anual. As licenças já cadastradas continuam guardadas. Toda empresa nasce **estabelecida**.
- O dashboard é clicável e o filtro vive na URL (`/admin/licencas?status=vencida&tipo=avcb_clcb`),
  então dá para guardar o link e o "voltar" do browser funciona.

Rotas da API (todas exigem admin): `GET /api/licencas/overview`, `GET /api/licencas/itens`,
`GET /api/licencas/empresas`, `POST /api/licencas`, `PATCH|DELETE /api/licencas/:id`,
`PATCH /api/licencas/empresas/:id/estabelecida`.

### Taxas anuais da prefeitura

Uma linha por **empresa e ano**, com estado `pendente` → `enviado` → `confirmado`. Empresa sem
marcação conta como pendente (não criamos registros em branco). O carimbo do primeiro envio não se
move nos cliques seguintes; voltar para *pendente* limpa as datas, para o histórico não afirmar um
envio desfeito. API: `GET /api/taxas-anuais?ano=2026` e `PUT /api/taxas-anuais` (upsert).

### Consentimento LGPD

No primeiro acesso o cliente vê o termo **uma vez** e **sem bloqueio**: pode concordar ou fechar em
"Agora não". Concordar grava `lgpd_consent_at` + IP + versão do termo; fechar grava
`lgpd_prompt_seen_at` e o aviso não volta. O admin acompanha em `/admin/lgpd` (aceito / visto sem
aceite / pendente).

O **texto do termo é fonte única** em `api/src/lgpd.js` e é servido por `GET /api/auth/lgpd-termo` —
o que o cliente lê é o mesmo que aparece na auditoria. **Ao alterar o texto, suba a versão**
(`LGPD_CONSENT_VERSION`): aceites antigos continuam registrados com a versão da época.

### Migração destas tabelas

`api/src/ensureLicensesSchema.js` roda **no arranque da API** (idempotente, mesmo padrão dos outros
`ensure*`): cria `company_licenses` e `annual_tax_receipts` e adiciona em `companies` as colunas
`established` e `lgpd_consent_at/_ip/_version` + `lgpd_prompt_seen_at`. Instalações novas já vêm
com tudo em `db/init.sql`. **Não há passo manual no deploy.**

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
