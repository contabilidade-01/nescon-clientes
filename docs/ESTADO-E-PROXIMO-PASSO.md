# Estado do sistema e próximo passo

Documento de passagem entre sessões. Quem pegar o projeto daqui lê **só este
arquivo** e sabe onde está, o que já foi feito e o que fazer a seguir.

**Última atualização:** 12/08/2026 — para o commit exato e a lista completa,
rodar `git log --oneline -40` no repo. Este documento descreve o que mudou até
aqui; não travar num hash específico porque o trabalho continua.

---

## 1. O que é este sistema

**Portal do Cliente da Nescon Contabilidade** — o lugar onde cada cliente acessa
o que o escritório entrega, e onde o escritório controla o que precisa entregar.

Duas faces no mesmo aplicativo:

| Face | Quem entra | O que faz |
|---|---|---|
| **Portal** | Cliente, login por **CNPJ** (ou CPF, se pessoa física) | Vê guias, boletos, folha, documentos, calendário de vencimentos, férias, e agora **chat com o escritório** |
| **Painel** | Escritório, login por **CPF** | Cadastro, licenças, taxas, LGPD, sincronização, usuários, folha, boletos, alertas, atendimento, configuração de IA |

### Pilha e infraestrutura

- **Front:** React + Vite + TypeScript, shadcn/ui, TanStack Query, React Router
- **API:** Node + Express, PostgreSQL (`pg`), JWT
- **Deploy:** Docker Compose (postgres + api + web/nginx) no **EasyPanel**, VPS,
  domínio `app.gestaoempresa.com`. Serviços no compose: `api-1`, `web-1`,
  `db-password-fix-1` (roda uma vez no boot).
- **Repo:** `contabilidade-01/nescon-clientes`, branch `main`.

> ⚠️ **`git push` neste ambiente tem sido lento/instável** — comandos com
> timeout curto (2-3 min) às vezes retornam código de erro **mesmo quando o
> push terminou**. Sempre conferir com `git log --oneline origin/main -1`
> antes de assumir que falhou e tentar de novo.

### Duas decisões de arquitetura que explicam quase tudo

**1. Migração no arranque, nunca à mão.** Cada assunto tem um
`api/src/ensure*.js` idempotente, chamado em `api/src/index.js` na subida.
Deploy nunca exige SQL manual. São dezenas desses arquivos hoje — todo
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` e `CREATE TABLE IF NOT EXISTS` vive
ali, nunca em migração numerada separada.

**2. Estado é calculado, não gravado — quando possível.** Situação de licença,
situação de férias, alerta de faltas, data de vencimento de tributo: tudo isso
sai de função pura na hora da leitura (`licenseStatus.js`, `vacationRules.js`,
`obrigacoes.js`). A exceção deliberada é `payroll_snapshots` (retrato do
extrato, por PDF externo e mutável — ver §4) e agora **parcelamentos**, que por
natureza são acordo individual, não regra calculável (ver plano em §7).

### De onde vêm os dados

O **G-Click** (sistema do escritório) é uma esteira de entrada: sincronização
periódica baixa guias e o Extrato Mensal. **O portal não depende dele para
existir** — cadastro manual, upload manual, Cora (boletos) e os módulos novos
funcionam sozinhos. Ver `PLANO-INDEPENDENCIA-GCLICK.md` para o histórico dessa
decisão.

---

## 2. Módulos hoje (visão geral, atualizada)

| Módulo | Onde | Situação |
|---|---|---|
| Entregas (guias, boletos, folha, documentos) | portal + `/admin/entregas` | maduro |
| Calendário e próximos pagamentos | portal | maduro |
| Departamento pessoal (suspensão, advertência, atestados) | portal | maduro |
| Licenças, taxas anuais, LGPD | `/admin/licencas`, `/admin/taxas-anuais`, `/admin/lgpd` | maduro |
| Usuários do painel com permissão por área | `/admin/usuarios` | maduro |
| Clientes vindos do G-Click | `/admin/clientes-gclick` | maduro |
| Férias (previsão, custo, limite de faltas) | portal + `/admin/empresas` | maduro |
| Alertas de vencimento (catálogo, WhatsApp) | `/admin/alertas` | maduro, com correção recente (§3) |
| **Painel de folha + projeção do 13º** | `/admin/folha`, portal `/custo-folha` | maduro, mas passou por **4 correções de bug em sequência** (§3 — ler antes de mexer) |
| **Boletos Cora** (sincronização automática) | `/admin/boletos-cora` | maduro; tem `due_date`; cancelado/rejeitado não aparece mais como "pago" |
| **Chat/Atendimento** (cliente ↔ escritório) | portal `/mensagens`, `/admin/atendimentos` | implementado nesta leva de sessões — ver §5 |
| **Arquivamento e exclusão de empresa** (soft-delete em 2 níveis) | `/admin/empresas` | implementado — ver §6 |
| **Configuração de IA multi-provedor** | `/admin/config-ia` | **já existe e funciona**, mas só alimenta reconhecimento de CNPJ hoje — ver §7 (a seção mais importante deste documento para quem for mexer em IA) |
| Upload de documentos com reconhecimento de CNPJ | `/admin/doc-upload` | maduro |
| Carga histórica (arquivo, não cobrança) | `/admin/sincronizacao` | maduro |
| Backup diário do banco | `/admin/sincronizacao` | maduro |

---

## 3. A saga do 13º/férias — histórico crítico, ler antes de mexer em folha

Esta seção existe porque o mesmo bug de fundo (pró-labore contaminando o
cálculo) **se escondeu atrás de quatro camadas diferentes**, e cada correção
só revelou a camada seguinte. Quem for mexer em `folhaKpi.js`,
`extratoEmployees.js`, `payrollRoles.js` ou `decimoTerceiro.js` precisa
conhecer essa cadeia inteira — senão o próximo ajuste corre o risco de
reintroduzir um dos quatro problemas já resolvidos.

**O sintoma original:** o 13º/férias projetado para empresas com sócio/diretor
(pró-labore) saía **inflado**, às vezes no dobro do valor correto.

**Camada 1 — a média salarial incluía o pró-labore.** `payroll_snapshots`
guardava `proventos` (Total Geral do extrato), que soma celetista + diretor.
Ao estimar salário de quem não tem valor individual cadastrado, o sistema
dividia esse total pelo número de "empregados" — entregando ao celetista uma
fatia do que o sócio ganha. **Corrigido**: passou a existir
`salario_contrib_empregados`, derivado só dos celetistas.

**Camada 2 — estagiário sem regra própria de férias.** O recesso do
estagiário (Lei 11.788/2008) não tem 1/3 constitucional nem FGTS — mas o
cálculo tratava como férias CLT normal. **Corrigido** em `vacationRules.js`.

**Camada 3 — o parser lê colunas fora de ordem em certos layouts de PDF.**
Provado com um extrato REAL da NESCON: o `pdf-parse`, para um dos layouts de
relatório, entrega o valor de um campo **antes** do próprio rótulo (ex.:
`"Estagiário<TAB>Vínculo: 220,00"` — o "220,00" pertence ao campo seguinte,
não ao vínculo). Isso fazia uma estagiária ser lida com vínculo = `"220,00"`,
que não batia com o padrão de exclusão e ela entrava na conta como CLT
comum. **Corrigido** em `extratoEmployees.js`: `capturarVinculo` e
`capturarSalario` agora tentam também o token **antes** do rótulo, e só
aceitam um vocabulário fechado (Celetista/Diretor/Estagiário/...) — nunca "o
que vier".

**Camada 4 — a causa raiz de verdade: `employees` nunca era sincronizada
automaticamente.** A leitura mensal do extrato sempre gravou só **totais
agregados** em `payroll_snapshots`. Ela nunca escrevia em `employees.vinculo`
— e é essa coluna que o filtro de elegibilidade do 13º/férias
(`funcionarioRealSql`, em `payrollRoles.js`) realmente consulta. `employees`
só era atualizada por upload manual de planilha ou edição avulsa — ninguém
repete isso todo mês, então o cadastro individual ficava desatualizado mesmo
com o parser (camada 3) já corrigido. **Corrigido**: `gravarSnapshot`
(`folhaKpi.js`) agora chama `sincronizarEmployeesDoExtrato()`, que faz
UPSERT em `employees` casando por CPF, toda vez que um extrato é lido.

**Lição para quem for mexer aqui:** sempre que um número de folha parecer
errado, **pedir o PDF real** e testar o parser contra ele — foi assim que as
quatro camadas foram encontradas, uma prova numérica de cada vez (a
matemática do valor errado sempre bate exatamente com alguma combinação
plausível de bug, e reproduzir isso é o que confirma a causa antes de
mexer no código).

**Ação pendente para quem reabrir isto:** depois de qualquer deploy que
toque nesses arquivos, **"Reler extratos"** (Admin → Folha) precisa ser
clicado de novo — é o único jeito de os snapshots e o cadastro `employees`
já existentes pegarem a correção nova. Sem isso, o código está certo mas o
dado gravado continua velho.

Um **bug não relacionado** também foi corrigido de passagem:
`permitidos is not defined` no ciclo diário de alertas — variável removida
num refactor anterior, referência ficou.

---

## 3.5 Aviso de "documento novo" — resolvido em 12/08/2026

Bug de arquitetura encontrado numa auditoria pedida pelo usuário ("certifique-se
de que a lógica de envio é real"): o aviso de documento novo por WhatsApp
**nunca disparava**, e nada no sistema acusava isso como erro.

**Causa**: o contrato original dependia do sistema de guias (GCLICK) chamar
`POST /api/fiscal/release` e, do lado de lá, decidir mandar o WhatsApp — o
portal só devolvia um campo `avisar_cliente` de sinalização. Quando o portal
passou a puxar e liberar documento sozinho (`gclick/sync.js`, direto na API
do G-Click, sem depender do GCLICK), **ninguém mais chamava essa ponta** —
e como o GCLICK está pausado a pedido do usuário, o lado que decidiria mandar
a mensagem nunca rodava. Achado só de propósito: `/release` foi auditado, o
código continuava sintaticamente correto, só que inerte.

**Correção — o Portal manda o aviso sozinho, sem depender de mais nada**:
- `api/src/docNotify.js` (novo) — `notificarDocumentosNovos(db, companyId,
  documentos)`, reusa o MESMO limitador de envio de `alertasEnvio.js` (teto
  de 180/hora, retry, trava contra mandar pro próprio número da instância) —
  é a mesma instância de WhatsApp, não dois limitadores somando.
- `gclick/sync.js` — cada sincronização acumula os documentos **realmente
  novos** (`status: "criado"`) por empresa e manda UM aviso por empresa no
  fim (não um por documento). Carga histórica e a carga inicial de portal
  vazio **não avisam** (`notificar: false`) — senão seria um WhatsApp por
  cliente avisando meses de documento antigo de uma vez.
- Upload manual do escritório (`routes/deliverables.js`) também avisa, sem
  bloquear a resposta HTTP (fire-and-forget).
- `/api/fiscal/release` (`fiscalIngest.js`) continua existindo por
  compatibilidade, mas hoje só teria efeito num resíduo de linha antiga
  ainda retida — o caminho normal nem passa mais por ali.

**Continua igual**: a preferência do cliente (`avisos_documentos_ativos`,
desligada no portal dele) é respeitada do mesmo jeito, e o número de WhatsApp
resolvido é o mesmo espelho já usado nos alertas de vencimento
(`whatsappSql`/`JOIN_ESPELHO`, exportados de `alertas.js` para reuso).

**Falta**: redeploy para pegar essas mudanças; sem redeploy, o gap descrito
acima continua valendo em produção.

---

## 4. Boletos Cora

Sincronização automática (a cada 6h) da conta Cora do escritório para
`deliverables` (`category='boleto'`, `source='cora'`). **Tem `due_date`** e
já entra nos alertas de vencimento e no calendário do cliente normalmente.

**Boleto cancelado/rejeitado na Cora** tinha um bug: virava `status='paid'`
(porque o modelo só tem pendente/pago), então o cliente via **"Pago"** num
boleto que ninguém quitou. Corrigido com uma coluna `cancelado` própria —
o boleto some das telas (admin e cliente) sem sumir do banco, e volta
sozinho se a Cora reabrir a cobrança.

O selo de status na tela do admin também ganhou o estado **"Atrasado Nd"**
(com a contagem de dias) — antes um boleto vencido continuava aparecendo
como "Pendente" comum, mesmo com o filtro "Atrasados" já certo.

---

## 5. Chat/Atendimento (cliente ↔ escritório)

Módulo novo, com um plano formal em duas versões —
**`PLANO-CHAT-ATENDIMENTO-V2.md` é a versão válida** (a V1 tinha falhas de
concorrência sérias, documentadas e corrigidas na V2).

**A regra de visibilidade, resumida:** conversa **sem dono** → todo
atendente vê (fila comum); conversa **assumida** → só o dono vê; **dono do
sistema** (`is_owner`) → vê tudo, sempre. Aplicada em SQL
(`chatCore.sqlVisibilidadeAdmin`), nunca só na tela.

**Pontos técnicos que evitam bug de concorrência:**
- "Assumir" é atômico (`UPDATE ... WHERE assigned_to IS NULL`) — dois
  cliques simultâneos, um ganha, o outro recebe 409.
- Idempotência por `client_msg_id` (evita mensagem duplicada em retry).
- Reabertura automática: cliente escreve numa conversa "resolvida" → ela
  volta pra fila, sem dono.
- `read_by_admin_at` só é gravado se `assigned_to = eu` — evita que um
  atendente zere o "não lido" de uma conversa que nem é dele.

**E-mail de notificação** (`chatEmail.js`): nunca bloqueia a resposta HTTP,
anti-flood de 15 min por conversa, HTML escapado. `CHAT_EMAIL_EQUIPE` (env)
manda tudo para um endereço único da equipe em vez de pulverizar para todos
os atendentes.

**Uma auditoria feita pelo próprio usuário** encontrou 3 desvios reais entre
o plano e a implementação (status em inglês vs português, chave de
idempotência gerada no lugar errado, badges de "não lido" nunca ligados na
tela) — todos corrigidos. **Lição**: mesmo com plano detalhado, auditar a
implementação contra ele antes de considerar pronto.

---

## 6. Arquivamento e exclusão de empresa

Dois níveis de "tirar do ar", propositalmente diferentes:

| | Arquivar | Excluir |
|---|---|---|
| Quem pode | Qualquer admin com área `empresas` | Qualquer admin com área `empresas` |
| Quem reverte | **Só o dono do sistema** | **Só o dono do sistema** |
| Efeito | Some das listas/contagens, para de receber tudo (alerta, cobrança, e-mail), perde acesso ao portal | O mesmo, mas semântica de "encerrado de vez" |
| Dado | Nada é apagado — é soft-delete com auditoria (`arquivada_em`, `arquivada_por`, `arquivada_motivo` / `excluida_*`) | idem |

A assimetria de permissão (qualquer um desativa, só o dono reativa) é
proposital: religar cobrança automática e acesso ao portal não pode
acontecer sem querer.

**Bug encontrado e corrigido nesta leva:** `listCompanies()` não filtrava
`arquivada`/`excluida`, então empresas arquivadas continuavam contando como
"ativas" no painel. Corrigido — todas as listagens do admin agora filtram
as duas colunas.

---

## 7. IA no sistema — o que existe, o que falta, e como qualquer sessão futura deve ligar novas capacidades a isso

**Esta é a seção mais importante para quem chegar perguntando "como
funciona a IA aqui" ou "preciso adicionar uma tarefa nova de IA".**

### 7.1 O que já existe e funciona

- **Tela** `/admin/config-ia` (`ConfigIaPage.tsx`): escolha de provedor
  (**Claude, Gemini, ChatGPT**), campo de chave por provedor, **teste de
  conexão real** (chama de verdade a API da Anthropic/Google/OpenAI e
  confirma resposta — não é simulado), toggle liga/desliga, limiar de
  confiança, timeout.
- **Backend**: `api/src/routes/admin.js` — `GET/PUT /admin/config/ia` e
  `POST /admin/config/ia/testar`. Variável de ambiente
  (`ANTHROPIC_API_KEY`/`GOOGLE_API_KEY`/`OPENAI_API_KEY`) tem **prioridade**
  sobre a chave salva pela tela.
- **Onde a IA é usada hoje: só reconhecimento de CNPJ em documento**
  (`api/src/pdfCnpjAi.js`), numa cascata de 3 níveis:
  1. regex puro (`pdfCnpj.js`)
  2. busca contextual (padrões tipo "CNPJ do contribuinte:")
  3. IA (só se os dois de cima falharem **e** a opção estiver ligada **e**
     houver chave)
- **Existe um SEGUNDO módulo de IA, mais antigo** (`api/src/pdfIa.js`):
  fallback via gateway compatível com OpenAI (originalmente o gateway da
  Lovable), com sua própria chave (`LOVABLE_API_KEY`/`IA_PDF_API_KEY`) e
  toggle próprio (`ai_parsing` em `app_settings`). `documentUpload.js` chama
  os dois em cascata: `pdfCnpjAi` primeiro, `pdfIa.cnpjPorIa` como
  **"fallback legado"** por último. Funciona, mas são dois sistemas
  paralelos — vale unificar quando alguém for mexer aqui de novo.
- **`api/src/pdfDueDate.js`**: leitor **determinístico** (regex sobre
  rótulos como "Data de Vencimento", "Pagar até") de data de vencimento em
  PDF. **Já existe e já funciona**, mas só roda no **upload manual** — não
  varre o banco automaticamente. Não tem fallback de IA ainda.

### 7.2 ⚠️ Problema de segurança — corrigido em 12/08/2026, falta ligar em produção

Chave de API salva pela tela (`ConfigIaPage.tsx` → `PUT /admin/config/ia`)
**agora é cifrada** (AES-256-GCM) antes de ir para `app_settings` —
`setSecretSetting`/`getSecretSetting` em `api/src/appSettings.js`, chave de
cifra vinda da variável de ambiente `SETTINGS_ENC_KEY` (nunca do banco).
**Sem essa variável definida, o sistema ainda funciona mas volta a gravar
em texto puro** (com aviso no log a cada gravação) — **definir
`SETTINGS_ENC_KEY` no ambiente de produção é o que falta** para o problema
estar realmente fechado. Trocar essa variável depois de já ter chaves
salvas invalida as chaves antigas (o admin precisa salvar de novo pela
tela).

### 7.3 Como uma sessão futura deve ligar uma NOVA capacidade de IA

**Não criar uma tela nova, não pedir chave de novo.** O padrão certo é:

1. Se a tarefa é "extrair algo de um PDF" (como vencimento, valor, o que
   for), escrever primeiro a versão **determinística** (regex), seguindo o
   modelo de `pdfDueDate.js`/`pdfCnpj.js` — nunca chuta, devolve `null` sem
   rótulo conhecido.
2. Para o fallback de IA, **reusar a config de `ConfigIaPage.tsx`**
   (provedor escolhido, chave, timeout) — não duplicar tela nem
   configuração. Hoje isso exige extrair a parte "chamar o provedor
   configurado" de dentro de `pdfCnpjAi.js` (está megulhada na lógica de
   CNPJ) para uma função genérica reutilizável — ver o plano detalhado em
   `PLANO-RECONHECIMENTO-VENCIMENTO-IA.md`, §3.
3. **Nunca aplicar o que a IA disse direto no banco.** Todo caso de uso de
   IA neste sistema segue "sugestão → fila de revisão do humano →
   confirmação → só então grava" (é assim que CNPJ funciona hoje; é assim
   que o plano de vencimento também propõe).

### 7.4 Planos escritos

- **`docs/PLANO-RECONHECIMENTO-VENCIMENTO-IA.md`** — **IMPLEMENTADO em
  12/08/2026.** Chave de IA agora cifrada (`SETTINGS_ENC_KEY`, §7.2
  resolvido — **falta só definir a variável em produção**, sem ela ainda
  grava em texto puro com aviso no log); `iaProvider.js` novo com
  `chamarIaConfigurada()` genérica, reusada por CNPJ e por vencimento;
  tabela `due_date_sugestoes` + rotina `varrerVencimentos()`; fila de
  revisão em `/admin/vencimentos-sugeridos`; toggle próprio
  `ia_vencimento_habilitada` dentro de `ConfigIaPage.tsx`. Ver o próprio
  plano (seção "O que foi feito") para o mapa completo arquivo-a-arquivo.
  **Falta**: redeploy (a tabela nova só é criada no arranque), definir
  `SETTINGS_ENC_KEY` no ambiente de produção, e rodar a varredura pela
  primeira vez pela tela.
- **`docs/PLANO-OBRIGACOES-TRIMESTRAIS-ISS-SIMPLES.md`** — **ainda não
  implementado.** Escopo revisto em 12/08/2026 depois do scanner de
  vencimento entrar no ar: **parcelamento (Simples/PGFN) e ISS por
  município deixaram de precisar de tabela/tela dedicada** — a guia de
  cada um é um PDF com data impressa, então sobe como documento comum e o
  scanner acha a data sozinho (mesmo fluxo de qualquer outro documento).
  O que continua de pé, sem depender do scanner: IRPJ/CSLL trimestral
  (com parcelamento em até 3 quotas — isso é modelagem de calendário, não
  falta de dado), pró-labore → INSS automático (baixo risco, reusa infra
  pronta), férias com marcação automática (achou que `FERIAS_LIMITE` está
  com `auto: null` — não liga sozinho hoje, apesar da infra de marcos
  90/60/30/15 já existir), e Simples/DAS (já quase pronto). O `ISS_UBERLANDIA`
  hardcoded no catálogo continua existindo e funcionando (mesmo motor do
  DAS/INSS/FGTS), mas é uma cidade só — não é ISS genérico.

**Se o usuário pedir para seguir com qualquer um dos dois planos**, ler o
documento inteiro primeiro — cada um já tem ordem de implementação sugerida
por risco/esforço e perguntas em aberto que precisam de resposta do usuário
antes de codificar.

---

## 8. Pendências que não são código

1. **Redeploy no EasyPanel.** Há commits recentes fora do ar cobrindo: as
   4 camadas do bug de folha/13º (§3), boleto cancelado (§4), chat (§5),
   arquivamento/exclusão de empresa (§6), e agora o reconhecimento de
   vencimento por IA (§7.4 — tabela `due_date_sugestoes` só é criada no
   arranque). As migrações rodam sozinhas no arranque — o log deve
   mostrar linhas `[DB] ... verificadas/criadas.`.
2. **"Reler extratos" (Admin → Folha)** depois do redeploy — obrigatório
   para os snapshots e o cadastro `employees` existentes pegarem as
   correções da §3. Sem isso, empresas com pró-labore continuam mostrando
   número errado mesmo com o código já certo.
3. **Definir `SETTINGS_ENC_KEY` no ambiente de produção** (§7.2) — sem
   ela, a chave de IA salva pela tela continua em texto puro (o código já
   está pronto, falta a variável no compose de produção).
4. **Decidir e possivelmente implementar** o plano de obrigações
   trimestrais/parcelamento/ISS (§7.4) — o de reconhecimento de vencimento
   já foi implementado nesta sessão.
5. Ligar `CHAT_EMAIL_EQUIPE` (env) se o escritório tiver mais de um
   atendente — evita e-mail pulverizado para todos a cada mensagem nova.

---

## 9. Mapa rápido do código (atualizado)

```
api/src/
  index.js                    arranque: monta rotas e roda os ensure* em ordem
  ensure*.js                  migrações idempotentes — dezenas de arquivos
  licenseStatus.js            regras de licença (puro, testado)
  vacationRules.js            Art. 130, custo, limite de segurança, recesso do
                               estagiário sem 1/3 (puro, testado)
  payrollRoles.js             funcionário × pró-labore × estagiário (puro,
                               testado) — funcionarioRealSql() é o filtro do 13º
  decimoTerceiro.js           projeção do 13º (puro, testado)
  folhaKpi.js                 leitura do extrato, snapshot, sincronizarEmployeesDoExtrato()
  extratoEmployees.js         parser por funcionário (vínculo/salário/cargo) —
                               endurecido contra layout de colunas fora de ordem
  extratoFinanceiro.js        parser dos totais agregados do extrato
  obrigacoes.js                catálogo de tributos + regra de vencimento
  alertas.js / alertasRegras.js  motor de marcação automática + texto do alerta
  alertasEnvio.js              disparo por WhatsApp (uazapi.js) — vencimento, lote diário
  docNotify.js                  disparo por WhatsApp de "documento novo" — reusa o
                                limitador de alertasEnvio.js; chamado por gclick/sync.js
                                e pelo upload manual (deliverables.js)
  coraSync.js / cora.js        sincronização de boletos Cora
  chatCore.js                  regras de visibilidade/transição do chat (puro)
  chatEmail.js                 notificação por e-mail do chat
  ensureChatSchema.js          tabelas do chat
  ensureArquivamentoSchema.js  colunas de arquivamento E exclusão de empresa
  pdfCnpj.js                   regex de CNPJ
  pdfCnpjAi.js                 cascata regex → contexto → IA (CNPJ)
  pdfIa.js                     fallback de IA legado (gateway Lovable)
  pdfDueDate.js                vencimento: regex determinístico + extrairVencimentoComIa()
  iaProvider.js                chamarIaConfigurada() — chamada genérica ao provedor de IA
                                configurado, reusada por CNPJ e vencimento
  dueDateSugestoes.js          varrerVencimentos() — varredura por competência, enfileira em
                                due_date_sugestoes (nunca aplica due_date sozinha)
  ensureDueDateSugestoesSchema.js  tabela due_date_sugestoes
  appSettings.js                chave/valor sem redeploy — segredos cifrados com
                                SETTINGS_ENC_KEY (setSecretSetting/getSecretSetting)
  adminAreas.js                áreas do painel (espelhado em src/lib/adminAreas.ts)
  companyTools.js              permissões do cliente (espelhado em src/lib/companyTools.ts)
  middleware/adminArea.js      requireArea / requireOwner — a trava de acesso
  routes/                      um arquivo por área da API

src/
  pages/                portal do cliente (inclui MensagensPage.tsx — chat)
  pages/admin/          páginas do painel (inclui ConfigIaPage.tsx, AtendimentosPage.tsx,
                         BoletosCoraPage.tsx, EmpresasPage.tsx com arquivar/excluir)
  components/admin/     AdminLayout, CompanyPicker, cards de importação
  lib/api.ts            cliente HTTP tipado — TODO tipo de resposta da API mora aqui
```

**Ao acrescentar uma chave de permissão do cliente**, mexer em 5 lugares:
`api/src/companyTools.js` (dois objetos), `api/src/ensureToolAccessSchema.js`,
`db/init.sql` e `src/lib/companyTools.ts` (lista + rótulo).

**Ao acrescentar uma área de permissão do admin**, mexer em:
`api/src/adminAreas.js` e `src/lib/adminAreas.ts`.

---

## 10. Onde está cada plano

| Documento | Assunto |
|---|---|
| **este arquivo** | Estado geral e próximo passo |
| [PLANO-CHAT-ATENDIMENTO-V2.md](PLANO-CHAT-ATENDIMENTO-V2.md) | Chat/atendimento — versão válida (a V1 tinha falhas de concorrência, corrigidas na V2) |
| [PLANO-OBRIGACOES-TRIMESTRAIS-ISS-SIMPLES.md](PLANO-OBRIGACOES-TRIMESTRAIS-ISS-SIMPLES.md) | IRPJ/CSLL trimestral, pró-labore, férias automática — **não implementado**. Parcelamentos e ISS por município rebaixados: resolvem via scanner de vencimento, não tabela dedicada |
| [PLANO-RECONHECIMENTO-VENCIMENTO-IA.md](PLANO-RECONHECIMENTO-VENCIMENTO-IA.md) | Reconhecimento de vencimento em qualquer documento via IA — **não implementado** |
| [PLANO-FERIAS.md](PLANO-FERIAS.md) | Férias — as 6 fases originais, implementadas |
| [PLANO-CLIENTES-GCLICK.md](PLANO-CLIENTES-GCLICK.md) | Clientes do G-Click — histórico |
| [PLANO-INDEPENDENCIA-GCLICK.md](PLANO-INDEPENDENCIA-GCLICK.md) | Futuro sem o G-Click: reconhecimento no upload, esteira do e-CAC, parcelamentos (contexto histórico da decisão) |
| [PROXIMOS-PASSOS.md](PROXIMOS-PASSOS.md) | Deploy e validação — pode estar desatualizado, conferir contra este documento |
| [../README.md](../README.md) | Referência técnica de cada módulo em produção |

---

## 11. Como uma sessão nova deve começar

1. Ler este documento inteiro primeiro.
2. Rodar `git log --oneline -20` e `git status` para saber exatamente o que
   está commitado, o que está só local, e se há algo pendente de push.
3. Se for mexer em folha/13º/férias: ler §3 inteira antes de tocar em
   qualquer arquivo — é a parte do sistema com mais histórico de bug sutil.
4. Se for mexer em IA: ler §7 inteira, especialmente §7.3 (como ligar uma
   capacidade nova sem duplicar infraestrutura) e §7.2 (o problema de
   segurança pendente).
5. Se o usuário pedir para "continuar o plano X": abrir o arquivo do plano
   e seguir a ordem de implementação sugerida nele — não pular direto para
   o código sem ler o plano inteiro, porque cada um documenta perguntas em
   aberto que precisam de resposta do usuário antes de codificar.
6. **Sempre que um número (financeiro, de folha, de imposto) parecer
   errado**: pedir o documento/PDF real ao usuário e testar o parser
   contra ele antes de propor correção. Foi assim que as 4 camadas do bug
   de §3 foram encontradas — nunca corrigir "no escuro".
