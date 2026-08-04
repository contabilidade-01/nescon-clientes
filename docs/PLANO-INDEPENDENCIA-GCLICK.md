# Plano — Alimentar o portal sem depender do G-Click

**Status: PLANEJADO, nada implementado.** Fases futuras, para depois do trabalho atual.

Data: 04/08/2026. Base: commit `d4cce65`.

---

## 0. Ponto de partida: o portal já não depende do G-Click para existir

Vale registrar, porque muda o peso das decisões abaixo. Hoje já dá para operar sem o G-Click:

| Função | Como funciona sem o G-Click | Onde |
|---|---|---|
| Cadastrar cliente | **Nova empresa (CNPJ)** | `/admin/empresas` |
| Entregar guia/folha/documento | Upload manual (arrasta o PDF) | mesma tela, por empresa |
| Funcionários | Importação por planilha | mesma tela |
| Licenças, taxas, LGPD | Nunca passaram pelo G-Click | páginas próprias |

O G-Click é uma **esteira de entrada**, não o alicerce. O que se perde sem ele é a automação da
alimentação — alguém subiria os PDFs à mão. As fases abaixo existem para que essa alimentação
manual seja rápida, e para abrir uma segunda esteira automática.

## 0.1 Decisão tomada em 04/08/2026

**O cadastro automático de cliente quando chega guia fica como está.** A Fase 4 do
[PLANO-CLIENTES-GCLICK.md](PLANO-CLIENTES-GCLICK.md) (tirar a criação automática de empresa) **sai
do escopo atual**.

Consequência a assumir de olhos abertos: enquanto a criação automática existir, o botão
**"não cadastrar"** da lista de clientes novos **não segura** um cliente que já tenha guia — a
empresa terá sido criada pela sincronização antes de você decidir. O alerta continua útil como
**aviso** ("entrou cliente novo"); a rejeição só passa a valer de fato quando a criação automática
for desligada. Se um dia quiser, isso volta como uma chave `GCLICK_AUTOCRIAR_EMPRESA`, sem refazer
nada do resto.

---

## 1. O que já existe hoje (verificado, não suposto)

- **Upload manual**: `src/components/AdminDeliverableUpload.tsx` + `POST /api/deliverables`. Você
  escolhe a empresa, a categoria e o tipo **na mão**; o portal só lê a data de vencimento do PDF
  (`api/src/pdfDueDate.js`).
- **Classificação de documento**: lista **fixa em código**, `TIPOS` em `api/src/gclick/guides.js` —
  FGTS, DCTF Web, INSS/GPS, DAS, ICMS, ISS, recibos e extrato de folha. Casa por nome de arquivo /
  atividade / obrigação, com ordem de precedência. **Não existe tela para editar esses padrões.**
- **Categorias do portal**: `guia`, `boleto`, `folha`, `outro`.
- **Porta de entrada de outro sistema**: rotas `/api/fiscal/*`, autenticadas por `X-Ingest-Key` — é
  como o GCLICK conversa com o portal hoje.
- **Parcelamentos: NÃO EXISTE NADA.** Nem seção, nem categoria, nem tipo de documento. Busca por
  "parcelamento" em `src/`, `api/` e `db/` não devolve uma linha.

---

## Fase F1 — Reconhecer o documento no upload manual

**Ideia:** arrastar uma guia no admin e o portal descobrir sozinho **de quem é** e **do que se
trata**, alocando direto no portal do cliente.

### Identificação do dono, nesta ordem

1. **CNPJ** encontrado no texto do PDF → casa com `companies.cnpj` (só dígitos).
2. **CPF** → casa com `employees.cpf`, e daí chega à empresa.
3. **Nome / razão social** → comparação tolerante (maiúsculas, acentos, `LTDA`/`ME` no fim).

A ordem importa: CNPJ é exato, CPF é exato mas indireto, nome é palpite. **Só os dois primeiros
podem alocar sozinhos.** Casamento por nome sempre pede confirmação — nome parecido entre duas
empresas do mesmo grupo é comum e o erro seria entregar guia de um cliente a outro.

### Identificação do tipo

Reaproveitar `classificar()` de `guides.js`, passando a ler também o **texto do PDF**, não só o
nome do arquivo. Mesma lista de tipos, mesma precedência — sem regra duplicada.

### Regras de segurança da alocação

| Situação | O que o sistema faz |
|---|---|
| CNPJ/CPF batem e o tipo foi reconhecido | Aloca, mostrando o que reconheceu, com botão **desfazer** |
| Achou o dono, não reconheceu o tipo | Aloca como `outro` e pede o tipo |
| Só bateu por nome | **Não aloca**: pede confirmação, mostrando o trecho que casou |
| Não achou ninguém | Fica numa bandeja de **não identificados**, sem sumir |
| Dois candidatos | Nunca escolhe: pergunta |

### Alocação manual direta

Continua existindo, escolhendo a empresa na mão — **com aviso** quando o que foi digitado
discordar do que o PDF diz: *"Este PDF parece ser de FULANO LTDA (CNPJ ...), e você está enviando
para BELTRANO. Confirma?"*. É o aviso que você pediu, e ele só aparece quando há divergência real —
avisar sempre treina a pessoa a clicar em "sim" sem ler.

**Nada é entregue ao cliente sem passar pela retenção que já existe** (`released_at`): reconhecer
errado não vira dano imediato, porque alguém ainda libera.

---

## Fase F2 — Segunda esteira: Central Pendências e-CAC (SERPRO)

O repositório `C:\Users\Jeandson\Documents\GitHub\central-ecac` já **emite** o que interessa:

- `POST /emitir` e `/emitir-lote` — DAS do Simples (e MEI)
- `POST` de DARF DCTFWeb, também em lote — é o INSS
- módulo de **parcelamentos** (`app/routes/parcelamentos.py`)

Ou seja, a segunda esteira não precisa ser construída do zero: é **ligar dois sistemas que já
existem**. O caminho natural é o e-CAC empurrar para o portal pela porta que já está aberta —
`/api/fiscal/*` com `X-Ingest-Key` —, exatamente como o GCLICK faz hoje. O portal não precisa saber
o que é SERPRO; recebe PDF, CNPJ, tipo e competência.

Ordem sugerida: **DAS primeiro** (mais volume, leiaute único), DARF DCTFWeb depois.

Pré-requisito herdado: a auditoria de captura de vencimento descrita em
[PROXIMOS-PASSOS.md §7.2](PROXIMOS-PASSOS.md) vale aqui também.

---

## Fase F3 — Parcelamentos (depois da implementação atual)

**Não existe nada hoje.** Precisa ser criado do zero:

1. **Categoria nova** `parcelamento` em `api/src/routes/deliverables.js` (`CATEGORIES`) e no
   `tool_access` das empresas — vira uma seção no portal do cliente, como *Guias* e *Boletos*.
2. **Três tipos**: `PARC_PREFEITURA`, `PARC_PGFN`, `PARC_RECEITA`.
3. **Reconhecimento**: "Parcelamento" sozinho não diz o órgão. Precisa de um segundo sinal no
   texto do PDF — `PGFN` / `Procuradoria` / `Dívida Ativa da União`; `Receita Federal` / `RFB`;
   nome do município / `Prefeitura`. Como parcelamento é mensal e recorrente, errar o órgão
   erraria todo mês.
4. Parcela tem **vencimento** → entra no calendário e nos próximos pagamentos, de graça.

### Tela de padrões de reconhecimento

Você perguntou se já existe: **não existe**. Hoje a lista de tipos é código
(`TIPOS` em `guides.js`) e mudar exige deploy.

Proposta — só faz sentido **depois** da F1, quando houver padrões suficientes para justificar:
mover `TIPOS` para uma tabela `document_patterns` (código, nome, categoria, padrões, ordem,
`tem_vencimento`) e uma tela `/admin/padroes-documentos` para o escritório criar e testar regras
sem depender de mim. Com um campo de teste: cola um texto, mostra o que a regra reconheceria.

Enquanto não houver essa tela, acrescentar um tipo continua sendo uma linha em `guides.js`.

---

## Ordem sugerida

| Ordem | Fase | Por quê |
|---|---|---|
| 1 | **F1** — reconhecimento no upload | Ganho imediato mesmo com o G-Click no ar; é a base do resto |
| 2 | **F3** — parcelamentos | Precisa da F1 para reconhecer; você já sabe que quer |
| 3 | **F2** — e-CAC | Maior, envolve custo de API SERPRO; a manual já cobre a emergência |
| 4 | Tela de padrões | Só quando houver padrões demais para viver em código |

Tudo isto vem **depois** do que já está em andamento: o plano de clientes do G-Click (fases 1, 2, 3,
5, 6) e o login com permissões.
