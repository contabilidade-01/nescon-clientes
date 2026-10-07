# Contratos — modelo preenchível, cadastro prévio, impressão, portal e assinatura eletrônica

Tela: **Painel › Cadastro › Contratos** (`/admin/contratos`, área `empresas`). Três abas:
**Contratos** (lista e editor), **Cadastro prévio** (ficha por empresa) e **Padrões do
escritório** (identificação da NESCON, regras e prazos-padrão).

A cronologia das decisões e a metodologia completa estão em
[CONTRATOS-HISTORICO.md](CONTRATOS-HISTORICO.md).

## O que faz

1. **Modelo pronto, texto único.** O contrato vive em `src/lib/contratoModelo.ts` como uma
   função que recebe os dados e devolve uma lista de *blocos* (capa, cartões, cláusulas,
   caixas, assinaturas). Dois modelos: **Completo** (ME/EPP e demais regimes, 8 cláusulas) e
   **Simplificado para MEI** (6 cláusulas). O que ficar em branco aparece **em amarelo**;
   trecho opcional vazio é simplesmente omitido do texto corrido.
2. **Prévia idêntica ao PDF.** `ContratoPreview.tsx` (HTML) e `generateContratoPdf.ts`
   (jsPDF) desenham a mesma lista de blocos. Mudou o texto no modelo, mudou nos dois.
3. **Imprimir / Baixar PDF.** Impressão usa o CSS de impressão da prévia (A4, só o
   documento). O PDF é gerado no navegador e baixado; serve para subir manualmente na
   ZapSign quando a API não está configurada.
4. **Salvar no portal do cliente.** O PDF (base64) vai para a API, que grava no volume de
   uploads e cria uma entrega em `deliverables` (categoria `outro`, `doc_type` `contrato`).
   O cliente vê em **Documentos**.
5. **Enviar para assinatura (ZapSign).** A API sobe o PDF na ZapSign com os signatários;
   a ZapSign e-maila (e, se marcado, manda WhatsApp) o link. O portal manda por SMTP uma
   cópia do PDF com o link. O webhook `doc_signed` (ou *Atualizar status*) baixa a via
   assinada, cria a entrega "Contrato assinado — …" e envia o PDF final por e-mail.
6. **Cadastro prévio por empresa.** Ficha com contratante, modelo/faixa, valores
   negociados e vigência, gravada em `contrato_cadastros`. Ao escolher a empresa num
   contrato novo, a ficha entra sozinha. No editor, o botão "Guardar estes dados como
   cadastro prévio" grava a ficha a partir do contrato aberto.
7. **Padrões do escritório.** Contratada, regras de cobrança e prazos-padrão, gravados em
   `app_settings` (chave `contratos_padroes`). Entram em todo contrato novo; os já criados
   não mudam.

Situações: `rascunho` → `salvo` (PDF no portal) → `enviado` (na ZapSign) → `assinado`.
Contrato assinado não se altera; mudou condição, cria-se outro (aditivo).

## O que é parametrizável (tudo entra no texto)

| Grupo | Campos |
|---|---|
| Modelo e faixa | modelo (completo/MEI), enquadramento, tipo de empresa, complexidade. Faixa sugerida: serviços R$ 280–350, comércio R$ 350–550 (`TABELA_BASE`); tabela de Atualização de Honorários prevalece quando existe. |
| Contratante | razão, tipo societário, CNPJ, NIRE, endereço, e-mail, telefone, representante (nome, qualificação, CPF, endereço, poderes). |
| Contratada | razão, CNPJ, CRC da organização, endereço, e-mail, telefone, representante e cargo, responsável técnico e CRC. |
| Áreas contratadas | contábil, fiscal e departamento pessoal, em qualquer combinação. O que ficar de fora sai dos cartões da cláusula 1 e gera o aviso "Áreas não contratadas" (demais obrigações legais fora do objeto; convite para incluir no pacote). |
| Honorários | valor mensal, dia de vencimento, limite de faturamento, empregados incluídos, valor por empregado extra, meio de pagamento, competência (corrente/vencido), 1ª cobrança, acima da faixa (R$ a cada R$), 13º (liga/desliga, duas parcelas dia/mês). |
| Regras | multa %, juros % a.m., dias para regularizar inadimplência, índice do reajuste anual automático, retroativo (dias e % da mensalidade), 2º recálculo de guia (R$), justa causa (dias para corrigir), limite da multa por dispensa do aviso (mensalidades), multa por infração (mensalidades). |
| Prazos e vigência | dia-limite das variáveis da folha, docs financeiros (dias após o mês), antecedência das guias, horário de atendimento, resposta (dias úteis), balanço anual (dias), entrega no encerramento (dias úteis), início, aviso prévio, foro, cidade e data da assinatura, testemunhas. |

## Configuração (variáveis de ambiente)

| Variável | Para quê |
|---|---|
| `ZAPSIGN_API_TOKEN` | Token da API (app.zapsign.com.br › Configurações › Integrações › API ZapSign). Sem ele o botão de assinatura fica desligado; o resto funciona. |
| `ZAPSIGN_SANDBOX=true` | Usa `sandbox.api.zapsign.com.br` (conta própria em sandbox.app.zapsign.com.br). **Sem validade jurídica** — só para testar. |
| `ZAPSIGN_API_URL` | Sobrepõe a URL base (raramente necessário). |
| `ZAPSIGN_WEBHOOK_SECRET` | Segredo do webhook. A tela mostra a URL pronta: `{PUBLIC_APP_URL}/api/contratos/zapsign/webhook?token={segredo}`. Cadastrar na ZapSign com o evento `doc_signed`. |
| `SMTP_*` / `PUBLIC_APP_URL` | Já existentes; usados para as cópias por e-mail e os links do portal. |

Sem webhook, o botão **Atualizar status** consulta a ZapSign na hora e conclui a assinatura
do mesmo jeito.

## Validade jurídica

A ZapSign faz assinatura eletrônica **avançada** (trilha de auditoria, IP, e-mail/WhatsApp,
opcionalmente CPF, selfie e token), válida entre particulares pela Lei 14.063/2020 e pela
MP 2.200-2/2001 (art. 10, § 2º). O contrato prevê expressamente a assinatura eletrônica
(cláusula "ASSIM", art. 784, § 4º, CPC). Para exigir certificado ICP-Brasil de um
signatário, troque `auth_mode` para `certificadoDigital` em `api/src/zapsign.js`.

## Rascunhos iniciais

Arquivos `api/src/seeds/contrato-*.json` entram uma única vez no arranque da API como
`rascunho`, sem PDF (hoje: o contrato da BQRB Óticas). Se já existir contrato com o mesmo
título, nada é repetido; se houver empresa no portal com o nome indicado, o rascunho já
nasce vinculado a ela.

## Onde está cada coisa

| Arquivo | Papel |
|---|---|
| `src/lib/contratoModelo.ts` | Tipos, padrões, formatação (moeda por extenso), faixa de honorários, mescla de padrões/cadastro, `montarContrato()` (completo) e `montarContratoMei()` |
| `src/lib/generateContratoPdf.ts` | PDF A4 com jsPDF (larguras reais da Helvetica embutidas) |
| `src/components/ContratoPreview.tsx` | Prévia HTML + CSS de impressão |
| `src/components/contratos/FormularioContrato.tsx` | Seções do formulário reutilizadas no editor, no cadastro prévio e nos padrões |
| `src/pages/admin/ContratosPage.tsx` | Abas, lista, editor, cadastro prévio, padrões, envio para assinatura |
| `src/lib/inputNum.ts` | Leitura de número digitado |
| `api/src/routes/contratos.js` | CRUD, PDF, padrões, cadastros, ZapSign, webhook |
| `api/src/zapsign.js` | Cliente da API ZapSign |
| `api/src/contratosMail.js` | E-mails do módulo |
| `api/src/ensureContratosSchema.js` | Tabelas `contratos` e `contrato_cadastros` + seeds |
| `src/test/contrato*.test.ts(x)` | Cálculos, texto gerado, prévia e PDF de amostra |

Para gerar PDFs de amostra (completo e MEI) e olhar o resultado:

```bash
CONTRATO_PDF_AMOSTRA=/tmp/amostra.pdf CONTRATO_PDF_AMOSTRA_MEI=/tmp/mei.pdf npx vitest run src/test/contratoPdf.amostra.test.ts
```
