# Onboarding — do contrato assinado ao primeiro mês rodando

O cliente novo recebe um **roteiro de primeiros passos**: o que enviar, até quando e por onde. O
escritório acompanha, aprova ou reprova cada arquivo e o sistema lembra o cliente dos prazos.

Telas:

| Quem | Onde | Para quê |
|---|---|---|
| Escritório | **Painel › Comercial › Onboarding** (`/admin/onboarding`, área `empresas`) | Acompanhar por status, aprovar/reprovar arquivos, criar à mão, ligar os lembretes |
| Escritório | **Onboarding › Modelos** (`/admin/onboarding/modelos`) | Construir os roteiros: arrastar e soltar, ou conversando com o agente de IA |
| Cliente (sem login) | `/onboarding/:token` | Link do e-mail de boas-vindas |
| Cliente (logado) | `/primeiros-passos` + aviso na página inicial do portal | O mesmo roteiro, sem precisar do link |

## Como nasce um onboarding

Quatro origens, o mesmo resultado (`onboardings.origem`):

- `contrato_auto`: o contrato foi assinado (webhook do ZapSign);
- `contrato_manual`, `proposta`, `empresa`, `manual`: criado pelo botão **Novo onboarding**.

O modelo é escolhido por `regras` (áreas contratadas, enquadramento, tipo de empresa, funcionários):
entre os modelos ativos que servem ao contrato vale **o de mais critérios**; empate, o de menor
`ordem`. Os blocos são resolvidos em **itens com data absoluta** e gravados no onboarding —
mudar o modelo depois não reescreve o que o cliente já viu. Código: `api/src/onboardingRegras.js`
(regras puras) e `api/src/onboardingServico.js` (banco e e-mail).

Prazo de documento/marco: `{ ref: 'assinatura' | 'inicio', dias, uteis }`. `inicio` é o início da
prestação (`vigencia.dataInicio` do contrato): quem começa depois da assinatura é cobrado a partir do
início real.

## 1. Construtor de modelos (arrastar e soltar)

`/admin/onboarding/modelos` → **Novo modelo** (ou clique num existente). Biblioteca: `@dnd-kit`.

- **Paleta** com os seis tipos de bloco: *Boas-vindas, Passo, Documento, Rotina do mês, Atendimento,
  Marco*. **Arraste** um tipo para a lista (entra na posição onde soltar) ou **clique** nele (entra
  no fim; é também o caminho por teclado/celular).
- **Reordenar**: arraste pela alça de cada bloco (o teclado também funciona: Espaço, setas, Espaço).
- Cada bloco abre um formulário próprio do tipo (formatos aceitos, obrigatório, como enviar,
  prazo, regra do mês, contato).
- **Mostrar só em alguns contratos** em qualquer bloco (`condicao`): mesmas chaves das `regras`.
- **Para quais contratos serve** (`regras`): áreas (todas as marcadas), enquadramento, tipo de
  empresa, com/sem funcionários. Sem nenhuma marca = serve para qualquer contrato.
- Textos aceitam `{{secao.campo}}` do contrato e `{{secao.campo|padrão}}`, ex.:
  `Todo mês, até o dia {{prazos.diaVariaveisFolha|20}}.`

Tudo o que chega ao servidor (do construtor ou do agente) passa por `sanitizarBlocos` /
`sanitizarRegras`: tipo desconhecido é rejeitado, campo que o tipo não usa é descartado, prazo é
limitado a 0–365 dias e `exemploUrl` só aceita `http(s)`.

## 2. Agente de IA

Painel à direita do construtor. O operador conta que cliente quer atender (*"Simples, serviços, 3
funcionários"*); o agente pergunta só o que falta (até 3 perguntas por vez) e **devolve o modelo
inteiro** já montado. O rascunho na tela é substituído e aparece **Desfazer**. **Nada é salvo** até
o operador clicar em *Salvar modelo*, depois de revisar, arrastar e editar.

Garantias (mesmo desenho dos assistentes de contrato e proposta):

- o agente só devolve **dados** (via *tool use*), nunca texto livre que vá direto ao cliente;
- o retorno é sanitizado no servidor (`interpretarResposta` em `api/src/onboardingIa.js`);
- ele **não inventa exigência**: o que a Nescon pede vem da base de conhecimento, e o que não
  está nela ele pergunta antes de incluir.

### Base de conhecimento configurável

Botão **Base de conhecimento** no painel do agente: um texto livre (até 12.000 caracteres) com o
que o escritório pede por tipo de cliente, os prazos usuais e o tom dos textos. É lido a cada
conversa, então **vale na hora, sem redeploy**. Fica em `app_settings`
(`onboarding_ia_conhecimento`); *Restaurar texto inicial* volta ao padrão
(`CONHECIMENTO_PADRAO`). Edite com a prática real: quanto mais concreto (*"MEI: só cartão CNPJ e
extrato; prefira OFX"*), melhor o roteiro.

Configuração:

| O quê | Onde |
|---|---|
| Chave da Claude | `ANTHROPIC_API_KEY` ou **Configurações › IA** (a mesma dos outros assistentes) |
| Modelo | padrão `claude-sonnet-5-5`; troca por `ONBOARDING_IA_MODELO` ou pela chave `onboarding_ia_modelo` em `app_settings` |

Sem chave, o painel do agente avisa e o construtor continua funcionando à mão.

## 3. Lembretes automáticos de prazo

Painel **Lembretes automáticos de prazo** no topo de `/admin/onboarding`. **Nasce desligado**
(chave `onboarding_lembretes_ativo`): ninguém deve começar a escrever para cliente por acidente de
deploy.

Para cada **documento obrigatório** ainda sem envio, o cliente recebe um e-mail (com o link do
onboarding) nos marcos **2 dias antes, no dia, e 1, 3 e 7 dias depois** do prazo. Depois de uma
semana de atraso o sistema para de insistir — daí é com o escritório.

- O que **já foi enviado** (em análise) ou **aprovado** não é cobrado; **reprovado** é, porque o
  cliente precisa reenviar.
- Um e-mail por onboarding por rodada, listando os itens devidos.
- Cada lembrete (item + marco) sai **uma única vez** (registrado em `onboarding_eventos`, tipo
  `lembrete`, aparece na linha do tempo do onboarding). Depois de um fim de semana ou de o servidor
  ficar fora, sai **um** aviso, o do marco mais recente — não uma fila de atrasados.
- Só em **dia útil** e na **janela diurna** (08h–19h, `janelaEnvio.js`). O agendador confere a cada
  30 minutos. Sem SMTP ou com falha de envio, nada é marcado e a próxima rodada tenta de novo.
- Botões: **Ver o que sairia hoje** (simulação, não envia nem marca) e **Enviar agora**.

Lembrete por WhatsApp não está incluído: hoje é só e-mail.

Código: regra pura em `lembretesDevidos` (`api/src/onboardingRegras.js`); envio e agendador em
`api/src/onboardingLembretes.js`.

## 4. Versão dentro do portal logado

O cliente que já entrou no portal vê o aviso **Seus primeiros passos na Nescon** na página inicial
(com *x de y documentos enviados*) enquanto o onboarding da empresa não estiver concluído; ele leva
a `/primeiros-passos`, que mostra o mesmo roteiro do link do e-mail, com envio de arquivos item a item
(arrastar e soltar). Concluído, o aviso some.

- API: `GET /api/onboarding/portal` e `POST /api/onboarding/portal/itens/:itemId/arquivos`
  (login de empresa; admin não entra). O onboarding é o da `company_id` da sessão: o que está em
  andamento primeiro, senão o mais recente.
- Link público e portal usam o **mesmo** tratamento de envio (`receberEnvio`): extensões permitidas
  (pdf, imagens, xml, ofx, planilhas, doc, zip, pfx/p12, txt), item aprovado não recebe novo envio,
  status recalculado a cada upload.
- Só aparece para empresa **ligada ao onboarding** (`onboardings.company_id`). Onboarding criado
  por contrato/empresa já traz o vínculo; o criado do zero (`manual`) não tem empresa e continua só
  pelo link.

## Status e revisão

`aguardando` → `em_andamento` → `em_analise` → `concluido`. Concluído = todo documento obrigatório
**aprovado**. Reprovar exige motivo: o cliente lê. Os arquivos ficam em `onboarding_arquivos`; a
trilha, em `onboarding_eventos`.

## Mapa do código

| Peça | Arquivo |
|---|---|
| Regras puras (modelo, prazos, status, validação, lembretes) | `api/src/onboardingRegras.js` |
| Criar onboarding, e-mail de boas-vindas, status | `api/src/onboardingServico.js` |
| Agente de IA e base de conhecimento | `api/src/onboardingIa.js` |
| Lembretes e agendador | `api/src/onboardingLembretes.js` |
| Rotas (painel, link público, portal) | `api/src/routes/onboarding.js` |
| Esquema e modelos iniciais | `api/src/ensureOnboardingSchema.js`, `api/src/seeds/onboarding-modelos.json` |
| Construtor (arrastar e soltar) | `src/components/onboarding/ConstrutorModelo.tsx` |
| Painel do agente e base de conhecimento | `src/components/onboarding/AgenteOnboarding.tsx` |
| Tela do cliente (link e portal) | `src/components/onboarding/PassosDoCliente.tsx` |
| Páginas | `src/pages/admin/OnboardingPage.tsx`, `OnboardingModelosPage.tsx`, `src/pages/OnboardingPublicoPage.tsx`, `PrimeirosPassosPage.tsx` |
| Testes | `src/test/onboardingRegras.test.ts`, `onboardingModeloIa.test.ts`, `onboardingConstrutor.test.tsx`, `onboardingPublico.test.tsx` |
