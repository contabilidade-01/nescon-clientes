# Plano — Reconhecimento de vencimento em qualquer documento + IA multi-provedor

## Status: IMPLEMENTADO (12/08/2026) — itens 1 a 6 da ordem de implementação (§5)

Pedido do usuário em 12/08/2026. **Achado importante**: boa parte do que foi pedido já
existia no sistema, construído para outro fim (CNPJ) — este plano foi, em boa parte,
**estender e conectar** infra pronta, não construir do zero (ver §0).

### O que foi feito

| # | Item | Onde |
|---|---|---|
| 1 | Chave de IA cifrada em `app_settings` | `api/src/appSettings.js` (`encryptSecret`/`decryptSecret`, prefixo `enc:v1:`), `SETTINGS_ENC_KEY` em `.env.example`/`docker-compose.yml`. Sem a variável definida, ainda grava em texto puro (com aviso no log) — **definir em produção**. |
| 2 | `chamarIaConfigurada()` genérica | `api/src/iaProvider.js` (novo) — `pdfCnpjAi.js` foi simplificado para delegar aqui, mesma cascata de antes, sem duplicar chamada HTTP por provedor |
| 3 | Tabela + rotina de varredura | `api/src/ensureDueDateSugestoesSchema.js`, `api/src/dueDateSugestoes.js` (`varrerVencimentos`) |
| 4 | Prompt de vencimento + fallback de IA | `api/src/pdfDueDate.js` (`extrairVencimentoComIa`), toggle próprio `ia_vencimento_habilitada` (independente do de CNPJ) |
| 5 | Fila de revisão | `/admin/vencimentos-sugeridos` (`src/pages/admin/VencimentosSugeridosPage.tsx`) + rotas em `api/src/routes/admin.js` (`GET/POST /admin/vencimentos-sugeridos*`) |
| 6 | Configuração da rotina na tela | Campo de competência + "Rodar agora" na própria fila; toggle de IA para vencimento dentro de `ConfigIaPage.tsx` |

### Ajuste de escopo pedido pelo usuário após a 1ª entrega (12/08/2026)

O desenho original só varria documento **sem** `due_date` (preencher vazio). O
usuário pediu para o scanner também **validar** o que já está previsto: reler o
PDF de todo documento no período (não só os sem data), e só interromper o admin
quando o PDF **diverge** do que já está gravado — quando bate, segue em silêncio.

- `varrerVencimentos()` (`dueDateSugestoes.js`) não filtra mais por
  `due_date IS NULL` — varre tudo no período, exceto boletos Cora (`source <>
  'cora'`, já confiáveis pela API da Cora direto).
- Nova coluna `due_date_sugestoes.data_anterior`: nula quando o documento não
  tinha vencimento (caso "preenchimento"), preenchida quando havia um valor
  diferente do achado no PDF (caso "divergência").
- PDF confirma a data já gravada → não vira sugestão, some da fila (contador
  `confirmados` no retorno de `/vencimentos-sugeridos/rodar`).
- Fila (`VencimentosSugeridosPage.tsx`) mostra "Divergência: estava X, o PDF diz
  Y" com badge de alerta quando há `data_anterior`; os botões viram "Manter a
  atual" / "Trocar para a nova" nesse caso (mesmos endpoints de
  aprovar/rejeitar — só o texto muda).

### Bug de produção corrigido em 12/08/2026 — prioridade de rótulo escolhia a data errada

Auditoria pedida pelo usuário ("isso custa dinheiro, revise se está
configurado pra reconhecer com suas variações"), com modelo real de guias
(DAMSP/TFE, DAS Simples Nacional via SENDA, GFD/FGTS Digital, Receita
Federal/INSS, recibos de parcelamento Guarulhos). Testado contra o texto
real de cada um (script descartável, não faz parte do repo).

**Achado — não era falta de cobertura, era prioridade errada.** Em guia de
Simples Nacional reemitida com multa/juros (pagamento atrasado), o documento
tem DUAS datas: "Data de Vencimento" (a data legal original, já vencida) e
"Pagar este documento até" (a data real pra pagar ESTA guia, já com o
atraso considerado). A ordem antiga testava "Data de Vencimento" primeiro —
o parser **achava uma data e "acertava" com 100% de confiança
determinística, mas era a data errada**, sem nunca cair na IA (que só é
acionada quando o regex não acha nada). Exemplo real testado: guia
reemitida em 23/05/2022 tinha "Data de Vencimento" = 21/03/2022 (vencida) e
"Pagar até" = 31/05/2022 (a que valia) — o sistema escolheria a primeira.

**Correção v1 (descartada)**: primeira tentativa foi só inverter a ordem —
sempre preferir "Pagar até" quando existir. O usuário corrigiu: "Data de
Vencimento" **ainda é a referência certa pra todo e qualquer documento**; o
que precisa é identificar especificamente quando há juros/reemissão, não
descartar "Data de Vencimento" de forma geral.

**Correção final**: `pdfDueDate.js` busca as duas famílias de rótulo
separadamente (`ROTULOS_VENCIMENTO_LEGAL` = "Data de Vencimento" e
`ROTULOS_PAGAR_ATE` = "Pagar até"/"Pagar este documento até") e decide por
comparação: se as duas aparecem no documento e **divergem**, usa "Pagar
até" (a divergência em si já é a prova de juros/reemissão — não precisa
tentar ler um campo "Juros (R$)" à parte, cujo layout varia demais entre
tipos de guia pra ser confiável). Se as duas coincidem, ou só uma existe,
usa a que houver — "Data de Vencimento" continua sendo o padrão sempre que
não há motivo pra duvidar dela. O prompt da IA (fallback) recebeu a mesma
regra, para os casos raros que chegam até ela. Revalidado com os mesmos 6
documentos-modelo: todos batem, incluindo o "motivo" de cada escolha.

⚠️ `app/pdf_parser.py` (sistema de guias, projeto GCLICK, **pausado**) tem a
ordem antiga simples, sem essa comparação — não sincronizado de propósito
porque o GCLICK está parado. Se for retomado, revisar esse parser lá também.

**O que já está coberto sem custo de IA** (confirmado com os 5 documentos):
DAMSP/TFE, DAS Simples Nacional (com ou sem multa), GFD/FGTS Digital,
Receita Federal/INSS — todos resolvidos pelo regex determinístico, zero
chamada de IA. Ficha de arrecadação (boleto bancário old-school, tipo os
recibos de parcelamento de Guarulhos) também funciona quando tem "Vencimento"
próximo da data; um recibo de parcela **já paga** (2ª via) legitimamente não
tem vencimento futuro pra achar — cai em "sem vencimento identificável"
corretamente, não gasta IA à toa.

### Bug de produção corrigido em 12/08/2026 — timeout do nginx

"Rodar agora" rodava a varredura de forma SÍNCRONA dentro do request. Numa
competência com muitos documentos (ou com IA habilitada, até 30s por
documento) passava dos 60s do timeout padrão do nginx — o nginx devolvia a
própria página de erro dele (HTML) no lugar da resposta da API, e o front
mostrava "A API não respondeu em JSON (foi recebido HTML)". Corrigido:
`POST /admin/vencimentos-sugeridos/rodar` agora dispara em segundo plano e
volta na hora (202); `GET .../status` para o painel acompanhar — mesmo
padrão já usado pela sincronização com o G-Click (`sync.estaRodando()`).

### O que ficou de fora desta leva (não bloqueante, ver §6 perguntas em aberto)

- Rotina não roda sozinha em intervalo (é sob demanda, botão "Rodar agora") — se quiser
  agendamento automático (ex.: diário), é extensão futura simples sobre `varrerVencimentos()`.
- Sem badge de contagem de pendentes no menu (o Chat tem, esta fila não ganhou ainda).
- Perguntas do §6 (quais categorias entram na varredura, provedor padrão por tarefa)
  resolvidas com o comportamento mais simples: todas as categorias sem `due_date` entram,
  e o provedor é o mesmo já escolhido para CNPJ (não há hoje separação de provedor por
  tarefa — só o toggle de habilitar/desabilitar é separado).

---

## 0. Inventário do que já existe (auditado nesta sessão)

| Peça | Status | Onde |
|---|---|---|
| Boletos Cora com `due_date` | ✅ Pronto, já alerta | `coraSync.js`, `alertas.js` |
| Leitor determinístico de vencimento em PDF | ✅ Pronto, **mas só roda no upload manual** | `pdfDueDate.js` |
| Tela de múltiplos provedores de IA (Claude/Gemini/ChatGPT) | ✅ Pronto e funcional — chave por provedor, teste de conexão real, toggle, limiar de confiança | `ConfigIaPage.tsx` + `api/src/routes/admin.js` (`/config/ia*`) |
| Cascata regex → contexto → IA (para CNPJ) | ✅ Pronto, é o padrão a copiar | `pdfCnpjAi.js` |
| Fallback de IA "legado" via gateway único compatível com OpenAI | ✅ Existe, é o último recurso quando o de cima falha | `pdfIa.js` |
| **Mesma cascata para VENCIMENTO** (não só CNPJ) | ❌ Não existe | — |
| **Rotina que varre o banco a partir de uma competência** (não upload avulso) | ❌ Não existe | — |
| **Fila de revisão do admin** (aceitar/aplicar no calendário) | ❌ Não existe | — |
| Criptografia da chave de IA salva pela tela | ❌ **Falta — hoje é texto puro** | `appSettings.js` |

**Conclusão prática**: os itens ❌ são o escopo real deste plano. Os ✅ são pontos
de reuso — o desenho abaixo evita duplicar o que já funciona.

---

## 1. O fluxo pedido, formalizado

> *"[...] possa ser que tenha uma folha de pagamento, contrato etc, deveria ser
> capaz de reconhecer que não há data de vencimento. De outra forma, se houver
> data de vencimento a IA reconhece, coloca em um ambiente, nosso sistema
> confronta a data e dá alerta para o admin decidir, e decidindo aplica no
> calendário [...] mesmo que não façamos o envio dos alertas de documentos não
> "fixados", ele terá uma marcação nos próximos pagamentos."*

Traduzindo para o vocabulário do sistema:

```
1. Rotina roda sobre `deliverables` a partir de uma competência (nunca "tudo").
2. Para cada documento SEM due_date ainda:
     a. pdfDueDate.js (determinístico) tenta achar rótulo conhecido.
     b. Se não achar E a IA estiver ligada → cascata de IA (mesmo padrão do CNPJ).
     c. Se nada achar → marca como "sem vencimento identificável" (fica fora da
        fila — não é erro, é um fato: contrato/holerite legítimo sem data-limite).
3. Se algo foi encontrado (determinístico OU IA) → entra na FILA DE REVISÃO,
   nunca aplica sozinho. Mesma cautela do reconhecimento de CNPJ (2 etapas:
   sugerir, depois confirmar).
4. Admin abre a fila, vê "Contrato XYZ — vencimento sugerido 15/03/2027,
   confiança alta (IA) / determinístico", aprova ou rejeita.
5. Ao aprovar: due_date grava em `deliverables`. Documento entra em "Próximos
   pagamentos" do calendário do cliente — MESMO que a categoria dele não seja
   uma das que disparam alerta de WhatsApp/e-mail. Alerta e calendário são dois
   sistemas independentes; aplicar no calendário não liga alerta sozinho.
```

### 1.1 Por que "a partir de uma competência", nunca "tudo"

Já é o mesmo cuidado que `pdfCnpjAi.js`/upload manual tomam (custo por chamada de
IA, tempo de processamento). Ler o histórico inteiro da carteira de uma vez seria
caro e lento sem necessidade — documentos antigos já vencidos não mudam de
decisão por terem `due_date` preenchido ou não.

**Proposta de escopo do "a partir de"**: campo de configuração (mesmo padrão do
"Reler extratos" em Folha), com `desde` = competência, e filtro adicional
`due_date IS NULL` (só processa o que ainda não tem vencimento — não reprocessa
o que já foi decidido, evita custo repetido).

### 1.2 "Não fixados" não recebem alerta, mas aparecem no calendário

Confirma o que o usuário descreveu: o sistema já separa **categoria de entrega**
(`deliverables.category`) de **disparo de alerta** (`obrigacoes.js`, que só cobre
tributos/folha/férias). Um contrato com vencimento reconhecido pode virar linha
em "Próximos pagamentos" **sem** entrar no motor de alerta automático — são
consultas independentes hoje (`deliverables.due_date IS NOT NULL` para o
calendário; `company_obligations` + `obrigacoes.js` para o alerta). Não precisa
de mudança estrutural para isso — só de POPULAR o `due_date` de categorias que
hoje ficam sem.

---

## 2. Modelo de dados novo (mínimo)

```sql
-- Fila de revisão. Não escreve due_date direto em `deliverables` até o admin
-- decidir — mesmo princípio do CNPJ (sugestão != fato).
CREATE TABLE due_date_sugestoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id UUID NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
  data_sugerida DATE NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('determinístico','ia')),
  confianca TEXT,              -- 'alta'|'media'|'baixa', só quando origem='ia'
  provider_ia TEXT,             -- qual provedor respondeu (auditoria/custo)
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovada','rejeitada')),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  decidido_em TIMESTAMPTZ,
  decidido_por UUID REFERENCES platform_admins(id) ON DELETE SET NULL
);
```

Sem tabela nova para "sem vencimento identificável" — isso é só a ausência de
linha na fila (documento processado, nada encontrado, fim).

---

## 3. Extensão da IA — de "só CNPJ" para "qualquer tarefa de extração"

**Isto é o ponto de arquitetura mais importante do plano.** Hoje `pdfCnpjAi.js`
tem o prompt e a lógica de CNPJ **misturados** com a cascata regex→contexto→IA.
Para vencimento (e qualquer extração futura: valor, competência, etc.) reusar a
MESMA infraestrutura de provedor/chave/teste sem duplicar código, a chamada à IA
precisa ficar **genérica**, parametrizada por tarefa:

```js
// Hoje (pdfCnpjAi.js): prompt de CNPJ embutido na função de nível 3.
// Proposto: separar "chamar o provedor configurado" de "o que perguntar".

async function chamarIaConfigurada(db, { instrucao, pergunta, pdfBuffer, fileName }) {
  // Lê provider/chave/timeout da MESMA config de ConfigIaPage.tsx — não duplica.
  // Roteia para Claude / Gemini / ChatGPT conforme o que está salvo.
}

// pdfCnpjAi.js passa a chamar chamarIaConfigurada() com o prompt de CNPJ.
// pdfDueDate.js (extensão) chama a MESMA função com prompt de vencimento.
```

Isso responde à sua pergunta de "ligar a IA ao que ela é necessária": a
**mesma** tela/config atende os dois casos de uso (CNPJ hoje, vencimento amanhã,
o que vier depois) — não é preciso configurar IA duas vezes nem criar tela nova.
A "lógica robusta de ligar a IA ao que é necessário" já existe em esqueleto na
cascata determinístico→contexto→IA; falta só desacoplar o PROMPT da CHAMADA.

### 3.1 Correção de segurança necessária antes de expandir o uso

Chave de API em texto puro no banco (`app_settings`) era tolerável quando só
CNPJ dependia disso; ao expandir o uso (mais chamadas, mais valor da chave),
vale endurecer:

- Cifrar o valor antes de gravar (`crypto.createCipheriv`, chave de cifra vinda
  de variável de ambiente do servidor — nunca do banco, senão a proteção não
  protege nada). Decifrar só na hora de montar a chamada HTTP.
- Não é bloqueante para o resto do plano, mas deve entrar **antes** de qualquer
  provedor novo ser ativado em produção pela tela (hoje, quem usa ambiente
  continua seguro; quem salva pela tela, não).

### 3.2 Sobre "outra que entenda"

O pedido menciona um 4º provedor "que entenda" (subentendido). Não crio um 4º
agora sem saber qual — a arquitetura de `chamarIaConfigurada()` já fica pronta
para adicionar qualquer provedor compatível com o padrão `/chat/completions`
(a maioria é) trocando só a URL/formato de request, sem tocar no resto do fluxo.

---

## 4. Telas

### 4.1 Fila de revisão (`/admin/vencimentos-sugeridos`, nova)

Lista `due_date_sugestoes` com status `pendente`: empresa, documento, data
sugerida, origem (determinístico/IA), confiança. Ações: **Aprovar** (grava
`due_date` em `deliverables`) / **Rejeitar** (marca `rejeitada`, não repete a
sugestão no próximo ciclo). Mesmo padrão visual da Caixa de Saída do GCLICK
(fila com aprovação manual) — o usuário já validou esse padrão de UX antes.

### 4.2 Configuração da rotina

Dentro de `ConfigIaPage.tsx` (ou tela irmã): "Reconhecer vencimentos a partir de"
(campo de competência) + botão "Rodar agora" — mesmo padrão do "Reler extratos".

---

## 5. Ordem de implementação sugerida

| # | Item | Risco | Esforço |
|---|---|---|---|
| 1 | Cifrar chave de IA em `app_settings` (§3.1) | Baixo | ~meio dia |
| 2 | Extrair `chamarIaConfigurada()` genérica de `pdfCnpjAi.js` (§3) | Baixo | ~1 dia |
| 3 | Tabela `due_date_sugestoes` + rotina "a partir de competência" (§1, §2) | Médio | ~1-2 dias |
| 4 | Prompt de vencimento para IA + ligar em `pdfDueDate.js` como fallback | Baixo | ~meio dia |
| 5 | Tela de fila de revisão (§4.1) | Médio | ~1-2 dias |
| 6 | Configuração da rotina na tela (§4.2) | Baixo | ~meio dia |

**Não fazer nesta leva:** rodar sobre o histórico inteiro sem filtro de
competência; aplicar `due_date` automaticamente sem passar pela fila; criar
provedor de IA novo sem o usuário indicar qual.

---

## 6. Perguntas em aberto

1. Categorias como `folha`/`outro` (contrato, holerite) devem entrar nesta
   varredura, ou só as que hoje já não têm nenhum tratamento de vencimento?
   Alguns documentos (holerite) genuinamente não têm vencimento — o "não achou
   nada" precisa ser um resultado tranquilo, não um erro na tela.
2. Confirmar qual provedor fica como padrão para a tarefa de vencimento — pode
   ser diferente do CNPJ (ex.: Gemini mais barato para volume maior).
