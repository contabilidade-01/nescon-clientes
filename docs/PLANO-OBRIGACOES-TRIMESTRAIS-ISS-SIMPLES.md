# Plano — IRPJ/CSLL trimestral, parcelamentos (Simples/PGFN), pró-labore, férias, Simples/DAS e ISS por município

## Status: PLANEJADO (não implementado)

Escopo entregue pelo usuário em 12/08/2026. Este documento é só o plano — nenhuma
linha de código foi escrita para isto. Serve de handoff para a próxima sessão.

---

## 0. Resposta à pergunta do usuário — cadastro vs. automação

> *"Veja se faz mais sentido no caso de identificação automática de obrigações, se
> poderíamos fazer no cadastro do cliente [...] ou se ver que só pela automação dá
> pra reconhecer tranquilo também, melhor."*

**Híbrido, com o cadastro como fonte de verdade para o que é decisão, e automação
só para o que já é dado observável no sistema.** Justificativa, item por item:

| Precisa saber | Onde decidir | Por quê |
|---|---|---|
| Regime tributário (Simples / Presumido / Real) | **Cadastro manual** | É uma **opção legal** que a empresa faz junto ao Fisco, não algo que se infere de um PDF ou do CNPJ. Errar aqui manda a empresa pagar/deixar de pagar o tributo errado. O CNPJ na Receita até informa o regime **hoje**, mas o cadastro precisa ser a fonte porque o câmbio de regime (ex.: saiu do Simples em março) tem efeito retroativo que só o contador sabe. |
| Tem funcionário celetista / só pró-labore | **Automação (já existe)** | O sistema já lê isso de `employees.vinculo` a cada extrato (ver o commit `2e50bb2`, `payrollRoles.js`). Não precisa de campo novo — já é dado observado, mês a mês, com mais precisão que um cadastro que ninguém atualiza. |
| Optante do Simples (para fins de ISS/DAS) | **Espelha o cadastro, com automação como *sugestão*** | O motivo de já ter uma guia de DAS no portal (`das_no_portal`, já existe em `obrigacoes.js`) é forte indício, mas não é prova — uma empresa pode ter saído do Simples e ainda ter DAS de competência antiga no arquivo (o sistema já trata isso via `historico`, ver `alertas.js:64-69`). A automação **sugere**; o cadastro **confirma**.
| Município do ISS | **Cadastro manual com pré-preenchimento automático** | O CNPJ dá o município de domicílio fiscal, que normalmente é onde o ISS é devido — mas há exceção legal (ISS de serviço tomado no local da obra, serviços de construção civil, etc. — LC 116/2003 art. 3º) que só o contador identifica olhando o contrato. Pré-preencher e deixar o admin confirmar é o ponto de equilíbrio. |

**Decisão de arquitetura:** um card "Tributação" no cadastro da empresa
(`EmpresasPage.tsx` ou uma aba nova), com os campos abaixo, e o motor de marcação
automática (`aplicarAutomaticas`, em `alertas.js`) passa a **ler esses campos**
além dos sinais que já lê hoje.

---

## 1. IRPJ/CSLL trimestral (Lucro Presumido / Real Trimestral)

> ⚠️ **Correção**: eu tinha afirmado que "parcelamento" era exclusivo de IRPJ/CSLL.
> Está errado — o usuário apontou corretamente que também existe **parcelamento
> de débito do Simples Nacional** e **parcelamento na PGFN** (Dívida Ativa da
> União). São coisas **diferentes entre si e diferentes da quota trimestral**
> deste capítulo — ver §1.3 (novo) para a distinção completa. O que segue neste
> capítulo (§1.1/§1.2) vale só para a quota do IRPJ/CSLL trimestral em si.

### 1.1 Regra de vencimento — encaixa no padrão já existente

O sistema já resolve "dia fixo com ajuste de dia bancário" para outros tributos
(`obrigacoes.js`, tipo `dia_fixo`/`ultimo_dia_bancario`). IRPJ/CSLL trimestral só
precisa de um tipo de regra NOVO: **"trimestre com vencimento no mês seguinte ao
fechamento"**, porque a competência não é mensal.

```js
// Novo tipo de regra em obrigacoes.js, ao lado de dia_fixo/ultimo_dia_bancario:
{ tipo: "trimestral", mesFechamento: [3, 6, 9, 12] }
```

- Fechamento: **Mar/Jun/Set/Dez**.
- Vencimento da quota única (ou 1ª de 3): **último dia útil do mês seguinte** —
  Abr/Jul/Out/**Jan do ano seguinte** (o 4º trimestre atravessa o ano — atenção
  especial na função de cálculo, que hoje assume `ano` fixo).
- Usa a MESMA função `ultimoDiaBancarioDoMes` que já existe em `diasBancarios.js`
  — não precisa reinventar a lógica de feriado/fim de semana.

⚠️ **Correção ao texto do usuário**: a regra do "1º dia útil subsequente" só vale
para o **último dia útil recuando em feriado** — a função `diasBancarios.js` já
trata isso para outros tributos; validar que ela cobre virada de ano (dezembro→
janeiro) antes de reusar para o 4º trimestre.

### 1.2 Parcelamento em até 3 quotas — **por que NÃO é "marcar 3 obrigações"**

O sistema hoje modela 1 obrigação = 1 vencimento por competência. IRPJ/CSLL
trimestral parcelado são **até 3 vencimentos da MESMA obrigação**, com Selic
acumulada nas quotas 2 e 3 — não cabe no modelo atual sem mudança.

**Duas opções de desenho, a decidir na próxima sessão:**

- **(A) Três `docTypes` sintéticos** — `IRPJ_TRIM_Q1`, `IRPJ_TRIM_Q2`,
  `IRPJ_TRIM_Q3`, cada um com sua data. Simples de implementar, mas polui o
  catálogo e a tela de "obrigações aceitas" do cliente com 3 itens quase iguais.
- **(B) Uma obrigação com array de vencimentos** — muda a forma de
  `calcularVencimento` (hoje devolve 1 data) para poder devolver `[data1, data2,
  data3]` quando aplicável. Mais correto, mas toca mais código existente
  (alertas, calendário do cliente, painel).

**Recomendação:** (A) para entregar rápido e validar com o escritório se o
parcelamento é realmente usado na carteira antes de investir em (B). Overhead de
"3 itens no catálogo" é aceitável — o `ISS`/`DAS` já convivem com nomes parecidos.

Cálculo da Selic acumulada da 2ª/3ª quota: **não** projetar automaticamente — a
taxa Selic do mês só é conhecida no fechamento; mostrar "+ juros Selic" como aviso
textual na guia, sem valor calculado, é mais seguro que estimar errado.

---

## 1.3 Outros parcelamentos — Simples Nacional e PGFN (Dívida Ativa)

**Correção do escopo (ver aviso no topo do §1).** Estes dois **não são a mesma
coisa** que a quota trimestral de IRPJ/CSLL, e também não são iguais entre si.
Tratar os três com a mesma lógica seria o mesmo erro de generalização que já
aconteceu duas vezes nesta conversa (a média salarial e agora o parcelamento) —
por isso separo explicitamente o que cada um É, antes de propor solução.

### 1.3.1 Parcelamento de débito do Simples Nacional

Regulado pela **Resolução CGSN nº 140/2018** (arts. 46–54), não pela mesma lei do
IRPJ/CSLL. Diferenças estruturais que importam para o desenho:

- É parcelamento de **débito já apurado e vencido** (o PGDAS gerou um DAS que não
  foi pago, ou diferença de apuração), não uma forma alternativa de pagar o
  tributo do mês corrente. Não tem relação com o calendário mensal do DAS normal.
- Permite parcelar em **até 60 parcelas mensais e sucessivas** (regra geral —
  **valor mínimo por parcela e regras de reparcelamento mudam por
  legislação/resolução ao longo do tempo; não travar esse número no código sem
  revalidar na hora de implementar** — ver nota de incerteza abaixo).
- **O dia de vencimento de cada parcela não é uma data de calendário fixada em
  lei** (tipo "todo dia 20") — é definido no momento da **consolidação do
  pedido de parcelamento**, dentro do próprio portal do Simples Nacional, e
  passa a valer todo mês a partir dali. Ou seja: **não dá para calcular essa
  data a partir de regra nenhuma** — só existe porque alguém pediu o
  parcelamento e anotou a data que saiu.

### 1.3.2 Parcelamento na PGFN (Dívida Ativa da União)

Ainda mais heterogêneo. Não é UM parcelamento — é uma família de programas:

- **Parcelamento ordinário** (Lei 10.522/2002, art. 10) — até 60 parcelas,
  regra "genérica", mas ainda assim negociada por processo.
- **Parcelamentos especiais/extraordinários** — Refis, PERT, Programa de
  Retomada Fiscal, editais de **transação tributária** (descontos, entrada
  diferenciada, prazo próprio) — cada um criado por lei/portaria/edital
  **específico**, com suas próprias regras de número de parcelas, desconto e
  prazo. Não existe uma fórmula única para "o parcelamento da PGFN".
- Vencimento de cada parcela: **fixado no próprio acordo/edital**, contado a
  partir da data de adesão — de novo, não é uma data de calendário derivável.

### 1.3.3 O que isso muda no desenho — e por que não encaixa no motor de `obrigacoes.js`

O catálogo `obrigacoes.js` modela **tributo recorrente com regra de vencimento
fixada em lei, igual para toda a carteira** (dia 20, último dia útil, etc.) —
é isso que permite calcular a data sem gravar nada (`licenseStatus.js`/
`obrigacoes.js`, "a data é sempre calculada, nunca gravada"). **Parcelamento não
cabe nesse modelo**: é uma **dívida individual, negociada, com calendário
próprio por empresa** — o oposto de "regra igual para todo mundo".

**Decisão revista em 12/08/2026, depois de o scanner de vencimento (
`PLANO-RECONHECIMENTO-VENCIMENTO-IA.md`) entrar no ar: não construir uma
tabela `parcelamentos` dedicada.** Cada parcela normalmente sai como um
DARF/guia em PDF, com data de vencimento impressa. Se esse documento entra no
sistema (upload manual do escritório, categoria `guia` ou `outro`), o scanner
já lê essa data sozinho — mesmo fluxo de qualquer outro documento, sem
tabela nova, sem tela de cadastro nova. O escritório sobe o PDF da parcela
mês a mês, o scanner acha a data (ou confirma que já está certa), e ela entra
na fila de revisão como qualquer outra.

**O que isso NÃO resolve** (e por isso ainda fica registrado aqui, não é o
plano inteiro riscado):
- **Rastrear que a empresa TEM um parcelamento ativo** — isso é estado do
  escritório, nenhum PDF individual conta essa história. Continua sendo
  conhecimento de quem atende a carteira, não algo que o sistema hoje sabe
  sozinho.
- **Antecipar a parcela que ainda não foi gerada** — o scanner só lê o que
  já existe como arquivo. Se a guia da parcela de outubro só é emitida em
  outubro, não há como o sistema lembrar "gerar a guia" antes disso — é
  aviso reativo (documento já subiu), não proativo.
- Se essas duas lacunas se mostrarem um problema real na prática (parcelamento
  esquecido porque a guia não foi subida a tempo), aí sim vale revisitar um
  cadastro leve — mas só depois de testar se "só subir o PDF" já resolve a
  maioria dos casos da carteira.

### 1.3.4 Nota de incerteza (importante)

Os números específicos citados acima (60 parcelas, valor mínimo) são a regra
geral **na data deste plano** — parcelamento tributário é a área da legislação
que mais muda por reedição de programas especiais (PERT, Refis, transações
tributárias saem com frequência, cada um com prazo/desconto próprio). **Antes de
codificar qualquer limite numérico, confirmar a regra vigente** — errar aqui tem
custo real (orientar um parcelamento maior/menor do que a lei permite).

---

## 2. Pró-labore → INSS Pró-Labore (marcação automática)

**Menor risco, maior retorno — fazer primeiro.**

O sinal já existe: `employees.vinculo = 'Diretor'` / `eh_contribuinte = true`
(gravado automaticamente desde o commit `2e50bb2`). Falta só:

1. Novo `docType`/obrigação `INSS_PROLABORE` em `obrigacoes.js`, com `auto:
   "tem_prolabore"`.
2. Novo sinal em `retratoDasEmpresas()` (`alertas.js`): `temProLabore` **já
   existe** nessa função (`r.temProLabore = temAlgumNaFolha && !temFuncionario`)
   — só falta a obrigação nova consumi-lo em `decidirAutomaticas()`
   (`alertasRegras.js`).

Isso é praticamente reaproveitar infraestrutura pronta — estimativa de meio dia.

---

## 3. Limites e alertas de férias (2º período aquisitivo)

**Já existe base forte — é extensão, não feature nova. E há uma lacuna concreta,
confirmada no código: hoje o alerta não liga sozinho.**

O sistema já tem: `feriasPorAvisar()` com marcos de 90/60/30/15 dias
(`alertas.js`, `MARCOS_FERIAS_DIAS`), já cobre estagiário (recesso, ver
`vacationRules.js`), e o portal do cliente já tem tela de férias com badge de
urgência (`DueBadge`, `deliverableDisplay.ts`).

### 3.1 A lacuna: `FERIAS_LIMITE` não é `auto` — precisa de marcação manual hoje

Confirmado em `obrigacoes.js`:

```js
{
  codigo: "FERIAS_LIMITE",
  nome: "Limite de férias",
  regra: { tipo: "ferias_prazo" },
  avisarDiasAntes: 90,
  auto: null,   // <- aqui está a lacuna
  ...
}
```

Compare com `SALARIOS`/`INSS_FOLHA`/`FGTS`, que têm `auto: "funcionario"` — ligam
sozinhos assim que o sistema detecta funcionário celetista na folha (mesmo sinal
que hoje já vem, corrigido, de `employees.vinculo`). `FERIAS_LIMITE` **não segue
essa mesma automação**: mesmo uma empresa com funcionário celetista — que sempre
tem direito a férias — só entra no alerta de 90/60/30/15 dias se o admin marcar
a obrigação manualmente, empresa por empresa, na tela de obrigações.

**Correção proposta** (pequena, reaproveita infraestrutura 100% pronta):

1. Em `decidirAutomaticas()` (`alertasRegras.js`), adicionar o sinal
   `funcionario_ou_estagiario` ao mapa de sinais (hoje só existem `funcionario`,
   `funcionario_ou_prolabore`, `das_no_portal`).
2. Mudar `FERIAS_LIMITE.auto` de `null` para `"funcionario_ou_estagiario"` em
   `obrigacoes.js`.
3. `retratoDasEmpresas()` (`alertas.js`) precisa passar a calcular esse sinal —
   hoje só calcula `temFuncionario`/`temAlgumNaFolha`/`temDasNoPortal`; falta
   somar "tem estagiário" (a mesma consulta de `employees.vinculo = 'Estagiário'`
   já usada no filtro de férias).

Isso é literalmente o mesmo padrão do item 2 (INSS Pró-Labore) — baixo risco,
reaproveita tudo que já existe, só liga o interruptor que faltava.

**O que falta além disso (2º período aquisitivo específico):**

- O texto do usuário fala em **"segundo período aquisitivo"** — isso é o
  vencimento do **direito a gozar** (2 anos após o fim do 1º aquisitivo, dobro se
  não gozado). Confirmar se `vacationParser.js`/`vacation_periods` já distingue
  1º vs 2º aquisitivo ou só rastreia "o período atual" — se só rastreia um, a
  regra do "pagamento em dobro" precisa de um novo campo (`periodo_aquisitivo_n`)
  para diferenciar "primeiro vencimento" de "já vencido uma vez, dobro em jogo".
- Confirmar que o e-mail de férias (se já existe — ver módulo de alertas por
  e-mail do chat, `chatEmail.js`, como referência de padrão) dispara junto com o
  WhatsApp, ou se é só WhatsApp hoje.

**Ação concreta:** ler `vacationParser.js` e `ensureVacationSchema.js` a fundo na
próxima sessão antes de decidir se é ajuste de dado ou só de UI/alerta — não dá
para prometer sem essa leitura.

---

## 4. Simples Nacional / DAS "pela pasta"

**Parcialmente redundante com o que já existe — cuidado para não duplicar.**

`obrigacoes.js` já tem `DAS` com `auto: "das_no_portal"` — ou seja, **o sistema
já marca DAS automaticamente quando há guia de DAS no portal**. O pedido do
usuário ("se existir PDF/XML de DAS na pasta") é o MESMO sinal, só que fala em
"pasta" (sistema de arquivo) em vez de "portal" (o que já foi ingerido). Não
recriar — o ponto real de melhoria é:

- Confirmar que o campo `optante_simples` do cadastro (ver §0) **também** liga a
  marcação automática, não só a presença de guia — para os casos em que a
  empresa é do Simples mas ainda não tem DAS liberado no mês corrente (ex.:
  empresa nova, ainda sem primeira guia).

---

## 5. ISS por município

**A parte mais cara do pedido — tratar com expectativa realista.**

> **Revisão 12/08/2026 — rebaixado de "enviável" para o mesmo patamar do
> scanner.** Hoje existe `ISS_UBERLANDIA` no catálogo (`obrigacoes.js`),
> **hardcoded para uma única cidade**, `auto: null` (precisa marcação manual
> por empresa) — mecanicamente funciona (mesmo motor do DAS/INSS/FGTS), mas
> não é ISS genérico, é uma cidade só. Em vez de generalizar via §5.3
> (tabela de referência município×dia, mantida manualmente), a mesma lógica
> do §1.3 vale aqui: a guia de ISS também é um PDF com data impressa — se
> ela entra no sistema, o **scanner de vencimento já lê sozinho**, sem
> precisar saber a regra de nenhuma prefeitura. §5.1–§5.3 abaixo ficam como
> registro de raciocínio, mas a via barata a testar primeiro é "só subir a
> guia" antes de investir na tabela de referência.

> **Resposta direta (automático × manual)**: é híbrido, mas o corte é preciso —
> **automático** só até descobrir o MUNICÍPIO (via CNPJ); **manual** para o DIA
> DE VENCIMENTO daquela prefeitura, porque não existe fonte pública confiável
> para isso nos +5.000 municípios do Brasil. A tabela de referência (§5.3) faz
> esse "manual" virar automático **depois da primeira vez** — o escritório digita
> o dia uma vez por município atendido, e da próxima empresa daquela cidade em
> diante o sistema já pré-preenche sozinho.

### 5.1 O que dá para automatizar com segurança
- CNPJ → município de domicílio fiscal: **BrasilAPI ou ReceitaWS** (grátis,
  já usados em skills do usuário fora deste repo — ver
  `reference_consulta_cnpj_cidade_massa`). Confiável para o *nome* do
  município; não confiável para "onde o ISS é devido" (ver §0).

### 5.2 O que NÃO dá para automatizar com segurança agora
- **Regra de vencimento por prefeitura** (dia 8, dia 10, etc.) — isso é uma
  **tabela de referência que o escritório mantém**, não algo público e
  padronizado por API. Não existe fonte única confiável para "toda prefeitura do
  Brasil e seu dia de vencimento do ISS" — são milhares de municípios, cada um
  com sua lei própria, mudando sem aviso.
- **OCR de guia para achar prefeitura emissora + vencimento**: tecnicamente
  possível (o sistema já faz algo parecido em `pdfCnpj.js`/`pdfCnpjAi.js`), mas
  o formato de guia de ISS varia MUITO mais entre municípios do que o Extrato
  Mensal varia entre folhas — o retorno sobre o esforço é baixo comparado ao que
  acabamos de aprender com o parser de folha (2 layouts já geraram 4 correções
  em sequência). Não recomendo para a primeira entrega.

### 5.3 Desenho recomendado (fallback vira o caminho principal)

1. Campo novo em `companies`: `iss_municipio_nome`, `iss_municipio_codigo_ibge`
   (pré-preenchido via CNPJ, editável), `iss_dia_vencimento` (manual, o
   escritório digita — é o dado que eles JÁ sabem de cabeça para os municípios
   que atendem).
2. Tabela de referência **opcional e crescente**: `municipios_iss_referencia`
   (código IBGE → dia padrão), que o escritório popula conforme atende
   município novo — não uma tentativa de cobrir os +5.000 municípios do Brasil
   de uma vez. Quando o admin cadastra uma empresa nova, se o município já está
   na tabela de referência, pré-preenche o dia; senão, pede para digitar (e a
   entrada vira registro na tabela de referência, crescendo organicamente).
3. Nunca prometer OCR de guia de ISS nesta fase.

---

## 6. Ordem de implementação sugerida (por risco/retorno)

| # | Item | Risco | Esforço | Depende de |
|---|---|---|---|---|
| 1 | INSS Pró-Labore automático | Baixo | ~meio dia | nada — infra pronta |
| 2 | **Férias: `FERIAS_LIMITE` vira `auto`** (§3.1) | Baixo | ~meio dia | nada — infra pronta |
| 3 | Campo de regime tributário no cadastro | Baixo | ~1 dia | nada |
| 4 | Simples liga automação mesmo sem DAS ainda no mês | Baixo | ~meio dia | item 3 |
| 5 | ~~ISS: campos de município + dia manual~~ | — | — | **rebaixado 12/08 — testar via scanner primeiro (§5)** |
| 6 | Férias: confirmar 1º x 2º aquisitivo (além do §3.1) | Médio | leitura primeiro | vacationParser.js |
| 7 | IRPJ/CSLL trimestral, quota única | Médio | ~2 dias | item 3 |
| 8 | IRPJ/CSLL 3 quotas + Selic | Alto | a definir (A vs B) | item 7 |
| 9 | ~~Tabela de referência de município x dia ISS~~ | — | — | **rebaixado 12/08 — só revisitar se o scanner não bastar** |
| 10 | ~~Parcelamentos (Simples/PGFN) — tela de cadastro manual~~ | — | — | **rebaixado 12/08 — vira upload comum + scanner (§1.3.3)** |

**Não fazer nesta leva:** OCR de guia de ISS, cobertura de todos os municípios do
Brasil de uma vez, cálculo automático de Selic acumulada, **qualquer tentativa de
calcular data de vencimento de parcela de Simples/PGFN por fórmula** (não existe
regra de calendário — é sempre o que consta no acordo específico daquela
empresa).

---

## 7. Perguntas em aberto para o usuário (antes de começar a implementar)

1. O parcelamento em 3 quotas do IRPJ/CSLL é realmente usado por clientes da
   carteira, ou a maioria paga quota única? (define se o item 7 da tabela acima
   vale o esforço agora ou fica para depois)
2. Para ISS, quantos municípios diferentes a carteira atual realmente atende?
   Se forem poucos (São Paulo, Guarulhos, uma dúzia de cidades), a tabela de
   referência manual (§5.3) resolve tudo de forma barata; se forem dezenas,
   talvez valha revisitar o esforço de automação.
3. `vacation_periods` já distingue 1º vs 2º período aquisitivo, ou só guarda o
   período corrente? (pergunta técnica — respondo eu mesmo lendo o código na
   próxima sessão, incluída aqui só para registro do que falta confirmar)
4. Quantos clientes da carteira hoje têm parcelamento ativo (Simples e/ou PGFN)?
   Se forem poucos, o cadastro manual simples (§1.3.3) resolve tudo sem custo de
   desenvolvimento maior; se a carteira tem dezenas de parcelamentos ativos,
   talvez valha um campo de "nº de parcelas restantes" com contagem automática
   mês a mês (em vez de o escritório dar baixa manual), a desenhar depois.
5. Vale a pena revisar, antes de implementar §1.3, se algum parcelamento vigente
   hoje tem regra especial (desconto, carência, reparcelamento) que o modelo
   genérico proposto (nº parcelas + valor fixo + dia de vencimento) não
   representa bem — nesse caso a tela precisa de um campo de observação livre,
   no mínimo.
