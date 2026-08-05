# Estado do sistema e próximo passo

Documento de passagem entre sessões. Quem pegar o projeto daqui lê **só este arquivo** e
sabe onde está, o que já foi feito e o que fazer a seguir.

**Base:** commit `26a979c` · branch `main` · 123 testes passando
**Última atualização:** 05/08/2026

---

## 1. O que é este sistema

**Portal do Cliente da Nescon Contabilidade** — o lugar onde cada cliente acessa o que o
escritório entrega, e onde o escritório controla o que precisa entregar.

Duas faces no mesmo aplicativo:

| Face | Quem entra | O que faz |
|---|---|---|
| **Portal** | Cliente, login por **CNPJ** (ou CPF, se pessoa física) | Vê guias, boletos, folha, documentos, calendário de vencimentos e férias |
| **Painel** | Escritório, login por **CPF** | Cadastro, licenças, taxas, LGPD, sincronização, usuários |

### Pilha e infraestrutura

- **Front:** React + Vite + TypeScript, shadcn/ui, TanStack Query, React Router
- **API:** Node + Express, PostgreSQL (`pg`), JWT
- **Deploy:** Docker Compose (postgres + api + nginx) no **Easypanel**, VPS,
  domínio `app.gestaoempresa.com`
- **Repo:** `contabilidade-01/nescon-clientes`

### Duas decisões de arquitetura que explicam quase tudo

**1. Migração no arranque, nunca à mão.** Cada assunto tem um `api/src/ensure*.js`
idempotente, chamado em `api/src/index.js` na subida. Deploy nunca exige SQL manual.
Existem hoje 9 desses arquivos. `db/init.sql` espelha o resultado para instalações novas.

**2. Estado é calculado, não gravado.** Situação de licença, situação de férias e alerta
de faltas saem de uma função pura na hora da leitura (`licenseStatus.js`,
`vacationRules.js`). Nada envelhece no banco e nenhum resumo discorda da lista.

### De onde vêm os dados

O **G-Click** (sistema do escritório) é a esteira de entrada: a sincronização roda a cada
6 h, baixa guias e o Extrato Mensal, e alimenta o portal. **O portal não depende dele para
existir** — cadastro manual, upload manual e todos os módulos novos funcionam sozinhos.

---

## 2. Módulos hoje

| Módulo | Onde | Situação |
|---|---|---|
| Entregas (guias, boletos, folha, documentos) | portal + `/admin/entregas` | anterior a esta sessão |
| Calendário e próximos pagamentos | portal | anterior |
| Departamento pessoal (suspensão, advertência, atestados) | portal | anterior |
| **Licenças** (funcionamento, AVCB/CLCB, sanitária) | `/admin/licencas` | ✅ nesta sessão |
| **Taxas anuais da prefeitura** | `/admin/taxas-anuais` | ✅ nesta sessão |
| **Consentimento LGPD** | portal + `/admin/lgpd` | ✅ nesta sessão |
| **Usuários do painel com acesso por área** | `/admin/usuarios` | ✅ nesta sessão |
| **Clientes vindos do G-Click** (espelho, alertas, decisão) | `/admin/clientes-gclick` | ✅ nesta sessão |
| **Férias** (previsão, custo, limite de faltas) | portal + `/admin/empresas` | ✅ nesta sessão |
| **Cobertura operacional** | `/admin` | ✅ nesta sessão |
| **Alertas de vencimento** (catálogo, vínculo por empresa, texto) | `/admin/alertas` | ✅ sessão seguinte |

---

## 3. O que foi feito nesta sessão (24 commits, `a2eb3a0` → `26a979c`)

### Licenças, taxas e LGPD — `a2eb3a0`
Painel dividido por área com menu lateral retrátil (o antigo `AdminPage.tsx` de 679 linhas
virou 8 páginas). Licenças com dashboard clicável e marcação estabelecida × não
estabelecida. Taxas anuais por empresa e ano. Termo LGPD servido pela API, mostrado uma vez
ao cliente, com auditoria no painel.

### Usuários com permissão por área — `b9a4385`
`platform_admins` ganhou `nome`, `areas` (JSONB), `is_owner`, `active`. A trava é
`requireArea()` no **servidor**, rota a rota — esconder o item do menu seria contornável
pela API. Permissões lidas do banco a cada requisição.

### Clientes do G-Click — `5ecc5bb`, `7476fb0`, `0157aec`, `ff3b5f5`, `fcb3797`
Espelho `gclick_clients` + fila `gclick_pendencias`. Cliente novo vira decisão
(cadastrar/rejeitar); mudança de situação vira aviso. Backfill na primeira carga evita
dezenas de alertas falsos. **A Fase 4 ficou fora por decisão sua:** a criação automática de
empresa continua ligada, então "não cadastrar" não segura quem já tem guia.

### Férias — `8f65aed` (plano) e `ef44ea0` → `2fca675` (fases 1 a 6)
Extrato passou a guardar código e salário; leitura automática a cada sincronização; regras
do Art. 130; parser da Programação de Férias validado contra o PDF real do QUEIJEIRO 3
(15/15 funcionários); upload dentro de `/admin/empresas`; seção no portal; limite no
calendário.

### Correções e auditoria — `c0ead99`, `d697cfc`, `dda1fa2`, `26a979c`
CPF e inscrição inválida na decisão de clientes. Rolagem horizontal no celular (`min-w-0`
em flex/grid — 21 telas medidas a 375 px e 320 px). Alerta de cliente novo exclusivo do
dono. Menu Férias só para quem tem funcionário celetista. Seletor de empresa com busca.

---

## 4. Próximo passo: extrato completo por competência

### Por que este e não outro

O Extrato Mensal entra sozinho todo mês e nós aproveitamos **cinco campos**: nome, CPF,
código, cargo e salário. O mesmo PDF traz, por funcionário, proventos, descontos, líquido,
INSS, FGTS, base de IRRF e **faltas do mês** — e, no rodapé, os totais da folha.

Guardar isso por competência custa **duas tabelas** e destrava de uma vez os indicadores
que hoje são impossíveis: absenteísmo, massa salarial, evolução de custo de pessoal e
turnover. É o maior retorno por esforço que sobrou no sistema.

### K1 — Parser completo do extrato

**Arquivo:** `api/src/extratoEmployees.js` (estender, não reescrever)

Hoje ele já varre o bloco de cada funcionário para pegar salário e cargo. Acrescentar ao
mesmo bloco:

| Campo | Padrão no texto |
|---|---|
| `proventos` | `Proventos: 1.995,66` |
| `descontos` | `Descontos: 143,31` |
| `liquido` | `Líquido: 1.852,35` |
| `inss` | linha `I.N.S.S.  7,69  143,31` → **segundo** número |
| `fgts` | `Valor FGTS: 159,65` |
| `baseIrrf` | `Base IRRF: 1.852,35` |
| `faltas` | linhas `DIAS FALTAS` e `DIAS FALTAS DSR` → **somar as duas** |
| `admissao` | `Adm: 18/09/2025` |

E, no rodapé: `Total Geral Proventos`, `Total Geral Descontos`, `Líquido Geral`.

> **Gotcha que já nos custou tempo antes:** `I.N.S.S.` aparece **com pontos** e a linha tem
> dois números (alíquota e valor) — o que interessa é o segundo. Existe também
> `INSS EMPREGADOR` em alguns leiautes, como segunda tentativa.

> **Não copie as regex do app do Lovable sem conferir.** Elas foram escritas para o `unpdf`,
> que remonta as linhas por coordenada; nós usamos `pdf-parse`, que entrega os campos em
> outra ordem. Foi exatamente esse o tropeço no parser de férias.

**Pronto quando:** um Extrato Mensal real (pegar um da pasta do OneDrive, como fizemos com
a Programação de Férias) devolve todos os campos e os totais do rodapé **batem** com a soma
das linhas. Testes com trechos reais do PDF, não inventados.

### K2 — Tabelas e gravação

**Arquivos:** `api/src/ensurePayrollHistorySchema.js` (novo), `api/src/extratoAuto.js`
(estender), `db/init.sql`

```sql
-- Um retrato da folha por empresa e competência.
CREATE TABLE IF NOT EXISTS payroll_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  competencia TEXT NOT NULL,                 -- 'MM/AAAA'
  deliverable_id UUID,                       -- de qual extrato veio (rastreio)
  funcionarios INTEGER NOT NULL DEFAULT 0,
  total_proventos NUMERIC(14,2),
  total_descontos NUMERIC(14,2),
  liquido NUMERIC(14,2),
  total_inss NUMERIC(14,2),
  total_fgts NUMERIC(14,2),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, competencia)           -- reimportar ATUALIZA, não duplica
);

CREATE TABLE IF NOT EXISTS payroll_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES payroll_snapshots(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  codigo TEXT, nome TEXT NOT NULL, cpf TEXT, cargo TEXT,
  admissao DATE,
  salario_base NUMERIC(12,2),
  proventos NUMERIC(12,2), descontos NUMERIC(12,2), liquido NUMERIC(12,2),
  inss NUMERIC(12,2), fgts NUMERIC(12,2), base_irrf NUMERIC(12,2),
  faltas NUMERIC(5,1) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_payroll_entries_snapshot ON payroll_entries(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_payroll_snapshots_comp ON payroll_snapshots(company_id, competencia);
```

**Onde plugar:** `extratoAuto.processarEmpresa()` já lê o PDF quando o extrato muda. No
mesmo ponto, gravar o retrato — **upsert por (company_id, competencia)**, apagando e
regravando as `payroll_entries` daquela competência. Retificação do mesmo mês corrige o
retrato em vez de criar um segundo.

**Pronto quando:** rodar "Ler extratos agora" grava um retrato por empresa, e rodar de novo
não duplica nada.

### K3 — Indicadores do escritório

**Arquivo:** `api/src/routes/payrollKpis.js` (novo), montado em `/api/admin/kpis`

Por competência, para uma empresa ou para a carteira toda:

- **Massa salarial** — soma de `proventos`
- **Custo total de pessoal** — proventos + FGTS
- **Headcount** — contagem de `payroll_entries` excluindo pró-labore
  (usar `funcionarioRealSql()` de `api/src/payrollRoles.js` — a regra já existe)
- **Absenteísmo** — `SUM(faltas) / (headcount × dias úteis)` no mês
- **Turnover** — admissões (`admissao` dentro da competência) e saídas
  (`employee_exit_alerts` resolvidos como `inativado`)

Tela: um cartão em `/admin` com a evolução dos últimos 12 meses. O componente
`chart.tsx` do shadcn já está no projeto e ainda não foi usado.

### K4 — Indicadores do cliente

Seção no portal (chave nova em `tool_access`, mesmo padrão de `vacations`) com a evolução
da própria folha: massa salarial, headcount e absenteísmo mês a mês. Só faz sentido para
quem tem funcionário — reaproveitar `temFuncionarios`, que já vem na sessão.

### K5 — Engajamento (independente dos anteriores)

A tabela `deliverable_accesses` **já grava** abertura e download de cada documento desde
sempre, e só o sistema de guias consulta, por uma rota de serviço. Um relatório em cima
disso é quase de graça e responde: percentual de guias abertas por cliente, tempo entre
disponibilizar e abrir, e **quem nunca abre nada** — que costuma anteceder inadimplência.

---

## 4b. Alertas de vencimento — implementado (não commitado quando este texto foi escrito)

O módulo saiu na frente do extrato por competência, a pedido do escritório. **O portal
passou a ser o dono do aviso ao cliente** — o texto, a régua e o cadastro não dependem
mais do sistema de guias.

**A régua de datas** (`api/src/diasBancarios.js` + `api/src/obrigacoes.js`) é o coração.
Duas distinções que não podem ser perdidas por quem mexer aqui:

- **Dia bancário ≠ dia útil trabalhista.** Guia usa seg–sex sem feriado; o 5º dia útil do
  salário conta **sábado** (CLT art. 459 §1º). Contar salário com régua bancária adianta o
  prazo e faz o escritório cobrar cedo demais. Quando o 5º dia cai em sábado, a mensagem
  avisa que o pagamento tem de ser em dinheiro.
- **Dia 20 não é um só.** FGTS, INSS, DCTF Web e IRRF **antecipam** quando o dia 20 não é
  bancário; o **DAS adia** (LC 123, art. 21 §3º). Trocar os dois faz o cliente pagar com
  multa por causa do nosso alerta. Há teste cobrindo exatamente setembro/2026, em que o
  dia 20 é domingo.

Também não há expediente bancário em **24 e 31 de dezembro** (convenção da Febraban,
isolada numa função só, porque é convenção e não lei).

**Vínculo por empresa** — nem toda empresa tem toda obrigação. Duas categorias:

| | Regra | Marca sozinho? |
|---|---|---|
| FGTS, prazo do salário | tem funcionário celetista | sim |
| INSS (DCTF Web) | tem funcionário **ou** pró-labore | sim |
| DAS | há guia de DAS no portal | sim |
| todo o resto | o portal achou guia dela nas entregas | **não** — vira sugestão com evidência ("2 guias encontradas, a última em 2026-07") e o admin decide |

Sugerir em vez de marcar é deliberado: uma guia avulsa de ICMS num mês não prova
recolhimento mensal. **Decisão manual sempre vence a regra**, inclusive a negativa — o
`ON CONFLICT DO NOTHING` de `aplicarAutomaticas` nunca encosta em linha já decidida, e a
linha negativa é o que impede a mesma sugestão de voltar todo mês.

**A tela** (`/admin/alertas`, área nova `alertas`) tem três abas: *Empresas* (busca por
nome/CNPJ, detalhe com marcações, sugestões e preferências), *Catálogo* (a tabela com o
vencimento do mês já calculado, para conferir contra a tabela do escritório) e *O que sai
hoje* (o texto exato, montado, sem enviar nada).

**Cliente que não gosta de mensagem** tem duas chaves separadas em `companies`:
`alertas_ativos` (desliga tudo sem perder as marcações) e `incentivo_ativo` (mantém o
alerta e tira só a frase do fim).

**A mensagem de incentivo mudou de gatilho.** Saía na liberação de guias
(`POST /api/fiscal/release`), o que amarrava o incentivo ao sistema de guias; agora entra
como **última linha do alerta de vencimento**, sem título e sem separador — o cliente abriu
um aviso que quis receber e encontra uma frase a mais. As três travas de
`engagementRules.js` continuam valendo (só quem nunca acessou, a cada N alertas, piso de
dias), e a pré-visualização usa `simular: true`, que não consome o rodízio.

### O envio pelo WhatsApp (porte do sistema de guias)

O portal **manda a mensagem sozinho**. `api/src/uazapi.js` é o porte enxuto do
`app/uazapi.py`: como o alerta é texto puro, ficaram só `/send/text` e `/instance/status`
— nada de documento, botão, fila assíncrona ou encurtador de URL. Mesmas credenciais,
mesma instância, mesmo número do sistema de guias.

`api/src/alertasEnvio.js` é a rotina. **Seis travas, na ordem, cada uma barrando um jeito
diferente de estragar o canal:**

| # | Trava | Por que existe |
|---|---|---|
| 1 | uazapi configurada? | falha uma vez, com recado, em vez de sessenta vezes |
| 2 | número válido? (`whatsappNumero.js`) | fixo e número torto: a uazapi aceita e **a mensagem some** |
| 3 | não é o próprio número? | self-send responde sucesso e não entrega nada |
| 4 | teto por hora | rajada é o que faz o WhatsApp bloquear o número |
| 5 | pausa entre envios | cadência humana, não metralhadora |
| 6 | índice único no banco | processo morreu no meio? quem recebeu não recebe de novo |

`whatsappNumero.js` melhora um ponto em relação ao original: lá o 55 tinha de vir digitado;
aqui o portal **completa o DDI**. Exigir o 55 na mão só gerava cadastro errado. Fixo é
recusado com mensagem própria, para o admin trocar o cadastro em vez de caçar defeito no
envio.

**Erro de token não é repetido** — instância desconectada precisa de gente, e martelar a
API não resolve; o lote inteiro para e a tela diz por quê. Falha de rede tem uma
re-tentativa.

**Padrão é não enviar.** O agendador diário só liga com `ALERTAS_ENVIO_ATIVO=true`
(`ALERTAS_HORA`, padrão 8h de São Paulo). Ninguém deve começar a mandar mensagem para
cliente por acidente de deploy. Na tela há **Ensaiar** (monta tudo, aplica as validações,
não envia) e **Enviar agora**, este atrás de confirmação, porque chega no celular do
cliente e não desfaz. O incentivo só é consumido **depois** que a mensagem sai.

**Testes:** 64 novos (de 123 para **187**), todos de função pura — calendário, catálogo de
vencimentos, regras de marcação/mensagem e validação de número.

**Fora de escopo, confirmado:** o portal **não tem ambiente para guia de parcelamento**
(ver `PLANO-INDEPENDENCIA-GCLICK.md`, fase F3). A obrigação está no catálogo e vence no
último dia bancário, mas só se marca à mão e o alerta não terá guia para apontar até a F3.

---

## 4c. Upload de documentos com reconhecimento de CNPJ

`/admin/doc-upload`. O admin arrasta os PDFs, o portal lê o CNPJ e sugere o cliente, e a
pessoa confirma. Duas etapas de propósito: **analisar não grava nada**. Alocar documento
de um cliente para outro é o pior erro deste fluxo.

**A leitura é determinística por padrão** (regex sobre o texto do PDF). O fallback de IA
(`api/src/pdfIa.js`, porte da estratégia do app do Lovable, mesma chave `ai_parsing` em
`app_settings`) só roda quando o parser não acha nada **e** o escritório ligou a opção
**e** existe chave no ambiente. A ordem não é detalhe: o parser erra de forma previsível
— não acha, e avisa; a IA erra de forma plausível, devolvendo um CNPJ com cara de certo
tirado do rodapé errado. O que a IA ler entra marcado na tela para conferência.

Cuidados que valem a pena conhecer antes de mexer:

- **Âncoras no regex de CNPJ** (`(?<!\d)…(?!\d)`). A linha digitável de uma guia tem 44 a
  48 dígitos seguidos; sem as âncoras o padrão recorta pedaços dela, e cerca de **1%** de
  qualquer sequência de 14 dígitos passa no dígito verificador. Há teste com uma linha
  digitável real.
- **CNPJ do escritório é excluído** (`ESCRITORIO_CNPJ`): ele aparece no rodapé das guias
  que o próprio escritório emite.
- **A ordem de aparição decide a sugestão.** `= ANY($1)` não preserva ordem — a consulta
  traz os candidatos e a escolha é feita em JS, na ordem em que os CNPJs aparecem no PDF.
- **`file_name` é o nome que o cliente vê.** Guardar ali o nome interno entregaria
  `1754400000000-guia.pdf` para ele.
- **Sempre dá para escolher a empresa à mão**, inclusive quando nenhum CNPJ foi lido: PDF
  digitalizado sem camada de texto não pode virar beco sem saída.

**Varredura de órfãos** (`api/src/uploadsLimpeza.js`): o arquivo vai para o disco já na
análise, então lote abandonado vazava para sempre. A regra é conservadora — só remove o
que **nenhuma** linha de `deliverables`/`medical_certificates` referencia e que já passou
de `UPLOADS_TTL_HORAS` (48h); qualquer falha na consulta aborta sem apagar nada.

---

## 4d. O cliente decide o que quer receber

Até aqui, quem não queria mensagem tinha de ligar para o escritório. Isso vira ligação
que ninguém atende, e depois um cliente que ignora o canal inteiro. Agora a decisão é
dele, no portal dele — e o escritório **vê, mas não desfaz**.

**Três chaves, de donos diferentes.** Misturá-las faria o escritório desfazer sem querer
a vontade do cliente:

| Chave | Dono | O que faz |
|---|---|---|
| `alertas_ativos` | escritório | desliga tudo, sem perder as marcações |
| `avisos_documentos_ativos` | **cliente** | não quer aviso de documento novo |
| `vacation_alert_acks` | **cliente** | "já recebi este aviso de férias" |

**A dispensa de férias vale por funcionário × limite, nunca em geral.** Um interruptor
global resolveria o incômodo de hoje e criaria o de amanhã: o cliente que dispensou em
agosto não seria avisado do funcionário que vence em novembro, e o passivo apareceria sem
ninguém ter avisado. Presa ao período, a dispensa morre junto com ele — período novo volta
a avisar sozinho.

**O passo a passo vai dentro da mensagem**, não num link de descadastro. Um "clique para
não receber mais" pararia tudo com um toque, inclusive o aviso do funcionário que vence
daqui a três meses. Assim a saída existe, custa três toques e é por funcionário.

**O alerta de vencimento de guia não entra nessa tela**, de propósito: desligar sozinho o
aviso do que se paga com juros não é conveniência, é prejuízo silencioso. Quem quiser
parar fala com o escritório, que desliga sabendo o que está fazendo.

**Como o aviso de documento obedece.** Quem manda essa mensagem é o sistema de guias, não
o portal. `POST /api/fiscal/release` passou a devolver **`avisar_cliente`** e
`motivo_nao_avisar`; o sistema de guias lê o campo e, quando vem `false`, libera o
documento e **não envia** (`app/routes/envio.py`, no lote e no reenvio, registrando
`nao_avisado` na auditoria). Os dois lados precisam subir juntos: só o portal, e a vontade
do cliente fica registrada sem ser obedecida.

**Quem recebe é escolha da tela, não do ambiente.** A previsão tem **seleção por
empresa**: marcar um cliente e enviar é o que faz um piloto. A versão anterior usava uma
lista branca por CNPJ em variável de ambiente — e ela existia só porque a tela não
deixava escolher. Configuração cobrindo buraco de interface é dívida: cobrava redeploy
por decisão e tinha um modo de falha silencioso, porque variável não repassada pelo
compose ao contentor simplesmente não chega, e a restrição "configurada" não valia nada.

**Ligar o envio, a hora e o CNPJ do escritório também saíram do ambiente** para
`app_settings` (mesma tabela da chave `ai_parsing`), com cartão de configuração na aba
*O que sai hoje*. O agendador relê a cada ciclo de 15 minutos: ligar passa a valer sem
redeploy. O padrão continua sendo **não enviar**.

Sobrou no ambiente só o que o app precisa saber antes de existir: credenciais da uazapi,
`PUBLIC_APP_URL` e os limites anti-bloqueio.

> **Cuidado no piloto com o CNPJ da própria Nescon:** o destino **não pode** ser o mesmo
> número conectado na instância uazapi. Mandar para si mesmo falha em silêncio (a API
> responde sucesso e nada chega), e a trava anti-autoenvio barra antes disso.

**Telefone unificado.** O número passou a sair de `COALESCE(companies.whatsapp,
gclick_clients.phone)`: o cadastro vive no G-Click e `companies.whatsapp` é só a exceção
manual. Antes eram dois cadastros paralelos — cliente trocava de número, um dos dois era
atualizado, e metade das mensagens parava de chegar com sintoma que parecia aleatório. No
painel, o campo edita a exceção e mostra o número do espelho como marca-d'água.

---

## 4e. Carga histórica: arquivo, não cobrança

`/admin/sincronizacao` → **Carga histórica**. Escolhe-se a competência inicial (padrão:
janeiro do ano corrente) e o portal traz tudo o que existe na esteira do G-Click daquele
período — folha, INSS, FGTS, DAS e o que mais houver.

Duas diferenças em relação à sincronização normal, e as duas são o ponto:

1. **Entram já liberados.** O objetivo é o cliente ter o arquivo; retido ele não veria nada.
2. **Entram marcados como `historico`** e por isso **não viram cobrança**.

A segunda existe porque `/deliverables/upcoming` inclui vencidos **de propósito** — "o que
pagar a seguir" começa pelo que já passou. Sem a marca, puxar de janeiro encheria o portal
do cliente com meses de guias em vermelho, e ele não teria como distinguir dívida real de
documento de arquivo.

**Por que uma coluna e não `status = 'paid'`:** marcar como pago seria mais fácil e seria
mentira — afirmaria um pagamento que ninguém conferiu. `historico` diz o que a linha é.

No cartão do cliente, documento histórico troca o selo vermelho de atraso por um selo
neutro "histórico", mostra *"Venceu em … · documento de arquivo"* e **perde o botão
"Paguei"**, que não faz sentido ali.

**O mês corrente fica de fora** da carga: guia deste mês pode estar realmente a vencer, e
marcá-la como histórico esconderia uma cobrança de verdade.

**Três barreiras para a carga não virar alerta** (a data, sozinha, não bastava):

1. A previsão exclui `historico IS NOT TRUE` das guias. **Filtrar só por data seria
   insuficiente**: o `due_date` é lido do PRÓPRIO PDF, não da competência — guia antiga
   retificada, parcelamento ou prazo prorrogado podem gravar data futura numa linha
   velha. Ela passaria no `due_date >= hoje`, viraria "próxima guia" e faria dois
   estragos: dispararia aviso de documento de arquivo **e suprimiria o alerta verdadeiro**
   daquela obrigação, porque guia encontrada manda no catálogo.
2. A marcação automática ignora DAS histórico. Empresa que saiu do Simples em março ainda
   tem DAS de janeiro no arquivo, e a regra passaria a alertá-la de tributo que não
   recolhe mais.
3. A carga **regulariza o que já estava no banco** naquelas competências (`historico` +
   liberação), mas só o que estava **retido** — documento retido nunca foi visto pelo
   cliente, então tratá-lo como arquivo é dizer a verdade. Sem isso, metade do período
   pedido ficaria de fora, porque a sincronização normal já rodava com 6 meses.

Documento **já liberado** com vencimento passado continua como está: foi entregue como
cobrança de verdade, e escondê-lo apagaria uma dívida real da vista do cliente.

---

## 4f. Backup: o que é recuperável e o que não é

`docker-compose.yml` declara dois volumes Docker, **nenhum com backup**: `pgdata` e
`uploads`. A assimetria entre eles decide a prioridade.

**`uploads` é recuperável.** Quase todo PDF veio do G-Click e pode ser baixado de novo.
`/admin/sincronizacao` → **Arquivos no disco** confere cada entrega contra o volume e
separa o que voltaria (origem `gclick`) do que não voltaria (upload manual do escritório).

O reparo é indireto de propósito: em vez de uma segunda via de download, o botão apaga a
marca de versão (`gclick_versao_em`) das linhas órfãs. A sincronização seguinte deixa de
ver aquilo como "já tenho" e refaz o download **pelo caminho de sempre** — o mesmo código
já testado, sem uma rotina paralela para manter em dia.

**`pgdata` NÃO é recuperável, e é o que importa.** Decisões do escritório sobre
obrigações, consentimentos LGPD, preferências do cliente, dispensas de férias, histórico
de envio e de falhas — nada disso existe em outro lugar. Perder o banco é perder o
trabalho; perder os arquivos é perder uma tarde de sincronização.

**Backup diário do banco** (`api/src/backup.js`): `/admin/sincronizacao` → *Backup do
banco*. Gera o dump, **confere**, cifra e entrega por **dois canais separados**:

- **arquivo por e-mail, cifrado** (AES-256-GCM, chave derivada por scrypt de `BACKUP_SENHA`);
- **resumo por WhatsApp**, sem dado pessoal nenhum.

A separação é o ponto. O resumo é o que faz alguém **perceber que parou de chegar** —
cron silencioso falha meses sem ninguém notar — e o WhatsApp é onde o escritório olha
todo dia. O arquivo carrega CPF, PIS, salário e telefone de terceiros: mandá-lo em claro
por WhatsApp contradiria o consentimento LGPD que o portal pede na entrada.

**Ele se confere sozinho**, porque backup só descoberto no desastre é fé. Os modos de
falha reais não são "não sei restaurar" — são dump vazio, truncado, gerado contra o banco
errado, chave perdida. Nenhum se resolve depois. Cada execução: descompacta o próprio
arquivo, procura a marca de conclusão e as tabelas obrigatórias, e **conta as linhas**.
Os números vão na mensagem — se um dia chegar "3 empresas" onde chegavam 61, dá para agir
antes de precisar.

**`scripts/restaurar-backup.cjs` mora no repositório**, não num comentário do servidor:
é no dia em que o servidor se perde que alguém precisa dele. Testado de ponta a ponta —
cifra, decifra, rejeita senha errada, detecta arquivo estranho. (Precisa ser `.cjs`: o
`package.json` da raiz é ESM.)

**A senha fica fora do servidor.** Sem ela o arquivo é inútil — e o dia de precisar é o
dia em que o servidor não existe mais.

**Medição de volume** (120 guias e 23 extratos reais): guia mediana **152 KB**, Extrato
Mensal mediana **195 KB**. Para 60 empresas, um ano fica entre **0,4 e 1,0 GB** conforme
o número de guias por mês. Retificação **substitui** o arquivo (`removerPdf` em
`gclick/sync.js`), então versões não acumulam. Espaço não é o risco aqui — backup é.

---

## 5. Pendências que não são código

1. **Redeploy no Easypanel.** São **25 commits** fora do ar. As migrações rodam sozinhas no
   arranque; o log deve mostrar as linhas `[DB] ... verificadas/criadas.`
2. **Criar o Nelson** em `/admin/usuarios` (login por CPF; a senha inicial aparece uma vez).
3. **Marcar empresas não estabelecidas** em Licenças → aba *Empresas estabelecidas*.
4. **Decidir os clientes do G-Click** pendentes em `/admin/clientes-gclick`.
5. **Subir a Programação de Férias** de cada empresa em `/admin/empresas`.
6. **Conferir o Auto Deploy** — há indício de um único deploy manual (04/08, 07:34) e vários
   pushes sem deploy desde então.
7. **Alertas — cadastro inicial**, depois do deploy: (a) clicar *Aplicar marcações
   automáticas* uma vez, para FGTS/INSS/DAS/salário nascerem marcados na carteira inteira;
   (b) percorrer as **sugestões** empresa a empresa, aceitando ou recusando (recusar é o que
   faz a sugestão parar de voltar); (c) preencher o **WhatsApp** de cada empresa — sem ele o
   alerta não tem para onde ir; (d) conferir a aba *Catálogo* contra a tabela de vencimentos
   do escritório antes de qualquer envio.
8. **Ligar o envio automático**, só depois de conferir o catálogo e ensaiar: copiar
   `UAZAPI_SUBDOMAIN`/`UAZAPI_TOKEN` do sistema de guias para o ambiente do portal e pôr
   `ALERTAS_ENVIO_ATIVO=true`. Enquanto isso não for feito, o portal calcula e mostra, mas
   não manda nada — que é o padrão de propósito.

## 6. Itens de auditoria ainda abertos

| Item | Situação |
|---|---|
| Teste com Postgres de verdade | **aberto** — hoje há `schemaConsistencia.test.ts`, que confere INSERT/UPDATE contra o schema, mas nenhum teste executa SQL |
| Paginação em listas longas (licenças chega a ~180 linhas) | aberto |
| Estados de carregamento inconsistentes (Skeleton × "Carregando...") | aberto |
| Cabeçalho do PDF de férias depende da ordem das datas | aceito, documentado em `vacationParser.js` |
| Fase 4 do plano de clientes (desligar criação automática) | fora de escopo por decisão |

## 7. Onde está cada plano

| Documento | Assunto |
|---|---|
| **este arquivo** | Estado geral e próximo passo |
| [PROXIMOS-PASSOS.md](PROXIMOS-PASSOS.md) | Deploy e validação de licenças; login do Nelson; **aviso de vencimento por WhatsApp** (§7.2, com o pré-requisito da auditoria de datas) |
| [PLANO-FERIAS.md](PLANO-FERIAS.md) | Férias — as 6 fases, todas implementadas, com as decisões da execução |
| [PLANO-CLIENTES-GCLICK.md](PLANO-CLIENTES-GCLICK.md) | Clientes do G-Click — fases 1, 2, 3, 5, 6 feitas; a 4 registrada e fora de escopo |
| [PLANO-INDEPENDENCIA-GCLICK.md](PLANO-INDEPENDENCIA-GCLICK.md) | Futuro sem o G-Click: reconhecimento no upload, esteira do e-CAC, **parcelamentos** |
| [../README.md](../README.md) | Referência técnica de cada módulo em produção |

## 8. Mapa rápido do código

```
api/src/
  index.js                 arranque: monta rotas e roda os ensure* em ordem
  ensure*.js               migrações idempotentes (9 arquivos)
  licenseStatus.js         regras de licença (puro, testado)
  vacationRules.js         Art. 130, custo, limite de segurança (puro, testado)
  payrollRoles.js          funcionário × pró-labore (puro, testado)
  adminAreas.js            áreas do painel (espelhado em src/lib/adminAreas.ts)
  companyTools.js          permissões do cliente (espelhado em src/lib/companyTools.ts)
  extratoEmployees.js      parser do Extrato Mensal  ← K1 mexe aqui
  extratoAuto.js           leitura automática do extrato  ← K2 mexe aqui
  vacationParser.js        parser da Programação de Férias
  gclick/clientSync.js     espelho de clientes (regra pura em decidirEventos)
  middleware/adminArea.js  requireArea / requireOwner  ← a trava de acesso
  routes/                  12 arquivos

src/
  pages/            portal do cliente
  pages/admin/      9 páginas do painel
  components/admin/ AdminLayout, CompanyPicker, cards de importação
  test/             14 arquivos, 123 testes
```

**Ao acrescentar uma chave de permissão do cliente**, mexer em 5 lugares:
`api/src/companyTools.js` (dois objetos), `api/src/ensureToolAccessSchema.js`,
`db/init.sql` e `src/lib/companyTools.ts` (lista + rótulo).
