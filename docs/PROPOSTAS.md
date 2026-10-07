# Propostas — assistente, cenários prontos, catálogo de preços, PDF e envio

Tela: **Painel › Cadastro › Propostas** (`/admin/propostas`, área `empresas`). Duas abas:
**Propostas** (lista com situação e valores) e **Catálogo e pacotes** (o que o escritório vende,
por quanto e em quais cenários).

## A ideia: três caminhos para a mesma proposta

Entrar, escolher o caminho mais rápido para o caso e sair com o PDF:

1. **Assistente (agente).** Você descreve o cliente do jeito que vier — *"MEI com DASN de 2022 a
   2024 em atraso e uns R$ 8 mil de DAS para parcelar, depois quer a mensalidade"* — e ele monta
   os itens, preenche o cliente e só pergunta o que faltar (no máximo 2–3 perguntas por vez, no
   roteiro de cada cenário). A prévia do documento muda a cada resposta.
2. **Cenários prontos.** Um clique em *Regularização de MEI*, *Contabilidade mensal ME/EPP*,
   *Abertura de empresa*, *Alteração*, *Encerramento*, *Parcelamentos*, *Recálculos e meses em
   atraso* ou *Regularização de ME/EPP* traz os serviços do cenário e o roteiro do que perguntar.
3. **Formulário.** Abas *Serviços*, *Cliente* e *Condições* para ajustar tudo à mão
   (quantidades, valor, entrada/parcelas, prazo, textos). O que o assistente faz, dá para
   desfazer ou refinar aqui.

Tudo fica à vista numa prévia idêntica ao PDF (mesmo motor de blocos dos contratos). Campo
faltando aparece **em amarelo** `[ASSIM]`.

## Regra de ouro: quem calcula é o código, não a IA

O assistente **nunca escreve valor nem faz conta**. Ele só devolve um *patch*: quais cenários
aplicar, quais serviços do catálogo somar/alterar/tirar (por código), quantidades e dados do
cliente. O navegador valida o patch contra o catálogo (`aplicarPatch` em
`src/lib/propostaModelo.ts`: código inexistente é descartado e vira aviso no chat; número é
limitado; enum inválido é ignorado) e o motor calcula os valores. Sem chave da Claude, o
assistente fica desligado e o resto da tela funciona igual.

## Como cada serviço é cobrado

| Modo | Conta | Exemplos |
|---|---|---|
| Valor fechado | valor × quantidade | DASN em atraso (por ano), recálculo de guia (por competência), parcelamento (por pedido), abertura, alteração, encerramento |
| Mensal recorrente | valor × quantidade por mês | Mensalidade MEI, mensalidade ME/EPP, funcionário adicional, acompanhamento de parcelamento |
| Retroativo | mensalidade × meses | Contabilidade retroativa (escrituração dos meses em atraso) |
| Percentual | % sobre o valor da dívida, com mínimo | Parcelamento cobrado como % do débito |
| Repasse | custo de terceiros, sem margem | Certificado e-CPF/e-CNPJ |
| Sob consulta | sem valor | Taxas oficiais (Junta, prefeitura, bombeiros) |

Pagamento de cada item: à vista, **entrada % + saldo** (ex.: abertura 60% na contratação e 40% ao
final), parcelas, ou texto livre. A proposta mostra no topo o **investimento** (serviços +
mensal), o que sai na contratação, o saldo e os repasses.

### Automatismos

* **Mensalidade pela tabela.** Em ME/EPP o valor vem da tabela *Atualização de Honorários* (tipo ×
  complexidade) e, na falta dela, da faixa fixa (serviços R$ 280–350, comércio/indústria R$
  350–550). Muda tipo/complexidade, o valor acompanha — até você editá-lo à mão.
* **Funcionário excedente.** Informou mais funcionários que os incluídos na mensalidade (padrão
  3), o item *Funcionário adicional* (padrão R$ 70) é criado sozinho e some se o número baixar.
* **Condições sob medida.** O texto de condições só traz o que se aplica: vencimento e guias
  antecipadas se há mensalidade; procuração/e-CAC e "parcelas são pagas ao órgão" se há
  regularização ou parcelamento; custos de terceiros se há repasse; PIX se há cobrança pontual.
* **Validade.** Data + dias de validade (padrão 30) viram "válida até dd/mm/aaaa" e a lista marca
  proposta vencida.

## Catálogo e pacotes (configurações prévias)

Aba **Catálogo e pacotes** — vale para toda proposta nova (as já salvas não mudam):

* **Padrões do escritório:** nome/CNPJ/endereço do rodapé, cidade, validade, assinante e cargo,
  vencimento da mensalidade, forma de pagamento, chave PIX, funcionários incluídos e valor do
  adicional, antecedência das guias, texto de reajuste.
* **Serviços:** título, unidade, modo de cobrança, valor, entrada %, saldo, prazo, "o que está
  incluído" e observações. Desmarque para esconder do assistente e do menu. *Novo serviço* cria o
  seu (ex.: IRPF). *Restaurar padrão* volta ao catálogo embutido.
* **Cenários:** quais serviços cada cenário traz e o **roteiro de perguntas** (usado na tela e
  pelo assistente). *Novo cenário* cria o seu.

Os valores iniciais usam o que já é praticado (mensalidade 350/500, funcionário R$ 70, abertura R$
1.200 com 60/40, certificados R$ 150/180) e **estimativas para o resto** (DASN R$ 150/ano, recálculo
R$ 20/guia, DEFIS R$ 250, PGDAS R$ 100/competência, parcelamentos R$ 150–400, alteração R$ 600,
encerramento R$ 800…). **Revise-os na primeira vez.**

## Ciclo da proposta

`rascunho` → `salva` (PDF gerado) → `enviada` (e-mail ou marcada à mão) → `aceita` | `recusada`.
Proposta aceita não se altera (cria-se outra). Salvar sempre gera o PDF. Para cliente do portal,
"Disponibilizar o PDF no portal" espelha em **Documentos** (`doc_type` `proposta`).
*Resumo p/ WhatsApp* copia um texto curto com itens, totais e validade. *Enviar por e-mail* salva
a versão da tela e manda o PDF anexo (precisa de `SMTP_*`).

## Configuração

| Variável | Para quê |
|---|---|
| `ANTHROPIC_API_KEY` | Liga o assistente. Alternativa: chave da Claude em Configurações › IA (a mesma dos outros recursos de IA). Só o provedor **Claude** serve: o assistente usa *tool use*. |
| `PROPOSTA_IA_MODELO` | Troca o modelo (padrão `claude-sonnet-5-5`); também aceita a chave `proposta_ia_modelo` em `app_settings`. |
| `SMTP_*` / `PUBLIC_APP_URL` | Já existentes; usados no envio por e-mail e no link do portal. |

## Onde está cada coisa

| Arquivo | Papel |
|---|---|
| `src/lib/propostaModelo.ts` | Tipos, catálogo padrão, pacotes, cálculo (`calcularItem`, `totais`), automatismos (`reconciliar`), patch do assistente (`aplicarPatch`), texto (`montarProposta`) |
| `src/components/propostas/AssistentePropostas.tsx` | Chat; aplica o patch e mostra o que mudou |
| `src/components/propostas/FormularioProposta.tsx` | Abas Cliente, Serviços e Condições |
| `src/components/propostas/CatalogoEditor.tsx` | Padrões, cenários e serviços |
| `src/pages/admin/PropostasPage.tsx` | Lista, editor, prévia, PDF, e-mail, aceite/recusa |
| `src/lib/generateContratoPdf.ts`, `src/components/ContratoPreview.tsx` | Mesmo motor dos contratos; faixa do topo parametrizável (`faixa`) |
| `api/src/routes/propostas.js` | CRUD, PDF, catálogo, status, e-mail, rota do assistente |
| `api/src/propostaIa.js` | Chamada à Claude (tool `responder` obrigatória) |
| `api/src/ensurePropostasSchema.js` | Tabela `propostas` |
| `src/test/proposta*.test.ts(x)`, `api/test/propostaIa.test.js` | Cálculos, patch, texto, tela e IA simulada |

PDF de amostra para conferir o visual:

```bash
PROPOSTA_PDF_AMOSTRA=/tmp/proposta.pdf npx vitest run src/test/propostaPdf.amostra.test.ts
```

## Limites conhecidos / próximos passos

* O assistente não lê PDF/anexo de proposta antiga ainda; hoje ele parte do catálogo.
* Contratos: uma proposta aceita ainda não gera o contrato sozinha (o cadastro prévio do contrato
  poderia ser preenchido a partir dela).
* Sem escada de mensalidade na tela do item (o campo `escada` existe no modelo e sai no PDF; falta
  o editor).
