# Contratos — metodologia e histórico das decisões (06 e 07/10/2026)

Registro de como o módulo de contratos nasceu, da remodelagem do contrato em Word até
o cadastro prévio no portal, com cada decisão tomada no diálogo. Serve para quem for
mexer no texto do contrato ou no módulo entender **por que** cada coisa está como está.

## 1. Ponto de partida

- Havia uma **minuta longa** (14 páginas) do contrato NESCON × BQRB Óticas e um modelo
  visual de terceiros ("Box Contábil 360": azul-marinho `1F2A44`, dourado `CD9F3F`, cartões
  de resumo, caixas de destaque, passo a passo do encerramento).
- Pedido inicial: remodelar a minuta no visual do modelo, **enxuta sem perder segurança
  jurídica** e fácil de ler na forma e no conteúdo.

## 2. Metodologia do contrato em Word

1. Extraí o texto das duas .docx (XML) e renderizei o modelo em imagens para mapear os
   blocos visuais (faixa de título, cartões, caixas "!", destaques, passos, assinaturas).
2. Dissequei o `document.xml` do modelo em blocos reutilizáveis (tabelas com sombreamento
   e bordas) e escrevi um gerador em Python (`build.py` + `content.json`) que monta um novo
   `document.xml` com os mesmos blocos e o texto reescrito, preservando estilos, cabeçalho,
   rodapé e ícones do modelo. O logotipo da NESCON substituiu o do modelo.
3. Campos sem dado real saíram em **amarelo** (realce do Word) para nunca passarem
   despercebidos. Depois, com os dados confirmados, o Word passou a ter zero colchetes.
4. Validação: exportação para PDF via Word (COM) e conferência visual página a página.

## 3. Metodologia da página no portal

1. **Modelo de blocos.** Em vez de HTML solto, o contrato é uma lista tipada de blocos
   (`Bloco`): resumo, seção, parte, cláusula, barra, cartões, lista, alerta, destaque,
   passos, escudo, assinaturas. Um único `montarContrato(dados)` produz a lista.
2. **Dois renderizadores, um texto.** `ContratoPreview` (HTML/CSS, com CSS de impressão A4)
   e `generateContratoPdf` (jsPDF) desenham a mesma lista. Assim a prévia na tela, a
   impressão e o PDF baixado nunca divergem.
3. **Marcação mínima no texto**: `**negrito**` e `[CAMPO]` (amarelo). Trecho opcional vazio
   é omitido; termos sem valor ganham redação genérica.
4. **PDF fiel.** O jsPDF mede maiúsculas da Helvetica ~3,5% a menos que o leitor desenha
   (palavras colavam depois de "CONTRATANTE"). Solução: tabela de larguras reais (AFM da
   Adobe, extraída do pdfkit já presente na API) embutida no gerador.
5. **Backend** no padrão do projeto: migração idempotente no arranque
   (`ensureContratosSchema`), rotas Express sob `/api/admin/contratos` (área `empresas`),
   PDF gravado no volume de uploads e espelhado em `deliverables` para o cliente ver em
   Documentos; webhook público protegido por segredo.
6. **Assinatura eletrônica**: integração com a API da ZapSign (criar documento em base64,
   signatários, e-mail/WhatsApp, consulta de status, download da via assinada). Decisão
   do usuário: usar ZapSign por ora; a análise de alternativas está no item 5.
7. **Validação de ponta a ponta sem a ZapSign**: cluster PostgreSQL 17 temporário
   (binários locais, porta 5433) + API + Vite + navegador interno; login com administrador
   de teste; abrir rascunho, baixar PDF, salvar no portal e conferir banco e arquivo.
   Achado colateral: bug de instalação limpa no projeto (ordem de migrações), registrado
   como tarefa separada.
8. **Testes**: `contratoModelo.test.ts` (valor por extenso, texto gerado por parâmetro,
   mescla de padrões/cadastro, modelo MEI, faixa sugerida), `contratoPreview.test.tsx`
   (prévia renderiza e destaca pendências) e `contratoPdf.amostra.test.ts` (gera PDFs de
   amostra a partir do rascunho real da BQRB).

## 4. Cronologia das decisões do diálogo

| # | Pedido / dúvida | Decisão aplicada |
|---|---|---|
| 1 | Remodelar a minuta no visual Box, enxuta e legível | Contrato de 8 cláusulas + anexo, cartões e caixas, campos pendentes em amarelo. |
| 2 | Página no portal: preencher dados, imprimir, assinar com validade jurídica, cópia por e-mail, ficar no portal | Módulo Contratos: modelo de blocos, prévia/PDF, portal do cliente, ZapSign, webhook, e-mail. |
| 3 | Assinatura própria sem ZapSign tem validade? | Sim (avançada: OTP, hash, trilha, carimbo de tempo), mas terceiro neutro pesa a favor; sugerido híbrido. |
| 4 | API do gov.br no fluxo? | Só para órgão público (Login Único, domínio .gov.br); ITI anunciou abertura via certificadoras. Caminho manual existe. |
| 5 | "Vamos usar a ZapSign por hora" | Mantida a integração; passo a passo de configuração (token, segredo do webhook, sandbox). |
| 6 | Validar sem a API; tela nova sem dados; rascunho da BQRB | Contrato novo nasce em branco (só regras-padrão); seed `contrato-bqrb.json`; teste local completo. |
| 7 | Muitos colchetes; usar dados reais, texto corrido | Dados confirmados na Receita (BQRB CNPJ 68.972.725/0001-85, Simples; NESCON em Guarulhos, sócio-administrador). Opcionais vazios omitidos; genéricos quando sem valor. |
| 8 | Retroativo; folha até dia 2 | Cláusula 2.1 retroativo (depois: 90 dias, 50% da mensalidade por competência); variáveis da folha até o dia 2 (folha paga no 5º dia útil). |
| 9 | Modelos simplificados (MEI); recálculo de guia R$ 15; personalização por faixa | Modelo MEI; cláusula 2.2 recálculo (1º grátis, 2º R$ 15/guia); enquadramento/tipo/complexidade com faixa sugerida (serviços 280–350, comércio 350–550) e valor livre. |
| 10 | 13º condicionado a ter funcionário? | Avaliação: manter para todos (encerramento do exercício), com menos destaque: fora da capa e sem caixa, só item 5.3. |
| 11 | Faturamento acima da faixa; 13º fixo | R$ 100 a cada R$ 50 mil excedentes (configurável); 13º fixo no valor-base, sem acréscimos por empregados. |
| 12 | Tom: seriedade, responsabilidade e vantagem; segurança | Capa "Segurança"; quadro "O que a Contratada garante" abrindo a cláusula 3; cláusulas reescritas (sem fidelidade, nunca desassistida, nenhuma medida sem aviso). |
| 13 | Não enfocar erro da contabilidade; segurança = "contabilidade especializada"; guias por e-mail; abertura fora; 5.3 curta em 2 parcelas | Cartão "Contabilidade especializada"; 3.1 como item discreto; guias prioritariamente por e-mail com dever de acompanhar; abertura só na ressalva do 1.1; 13º em 25/11 e 18/12. |
| 14 | Excluir Anexo I e 8.2; justificar o 13º em uma frase | Anexo e cláusula da proposta removidos; 13º remunera o encerramento do exercício (prática usual). |
| 15 | Não há mensalidade proporcional | Retirada a proporcionalidade (início e encerramento imediato pagam mês integral). |
| 16 | 2.1 com 90 dias; cobrança só por e-mail sem a última frase; reajuste por índice fixo | 90 dias; "cobrança e nota fiscal enviadas apenas por e-mail"; reajuste automático anual pelo IPCA (IBGE), índice configurável. |
| 17 | Tudo personalizável + cadastro prévio | Nove regras que estavam fixas viraram campos; abas Cadastro prévio (por empresa) e Padrões do escritório; formulário dividido em seções reutilizáveis. |
| 18 | 5.1 só até a primeira cobrança; 5.3 invertida | 5.1 termina na primeira cobrança (meio de pagamento e e-mail saem dali); 5.3 começa pelo que a mensalidade cobre no ano (12 folhas, 12 apurações do Simples, escrituração mensal), depois as obrigações anuais impostas pelo governo e, daí, o 13º como remuneração desse trabalho; sem a frase "como é usual nos escritórios de contabilidade". |
| 19 | Tirar o endereço do rodapé | Rodapé de todas as páginas só com nome e CNPJ da NESCON; o endereço fica apenas na identificação das partes. |
| 20 | Contratação parcial (ex.: só fiscal) | Caixas "Áreas contratadas" (contábil, fiscal, pessoal). Com área de fora: cartões só das contratadas, aviso "Áreas não contratadas" (demais obrigações legais fora do objeto e da responsabilidade; convite a contatar a NESCON para incluir no pacote), honorários sem a parte de empregados quando pessoal fica de fora. Pacote completo não muda. |

## 5. Alternativas de assinatura avaliadas

- **ZapSign (escolhida)**: assinatura avançada por terceiro neutro; trilha de auditoria;
  API para criar documento, signatários, webhook e download da via assinada.
- **Plataforma própria**: válida (MP 2.200-2, Lei 14.063) com OTP, hash SHA-256, trilha e,
  idealmente, carimbo de tempo ICP-Brasil; custo zero por documento, mas a prova é guardada
  pela parte interessada. Estimativa: 2–3 dias de desenvolvimento.
- **gov.br**: assinatura avançada gratuita para o cliente, mas só manual (assinador.iti.br);
  a API de integração é restrita a órgãos públicos; abertura para privados anunciada via
  autoridades certificadoras, sem credenciamento disponível na data.

## 6. Pendências e observações

- Dados da NESCON ainda não cadastrados em lugar nenhum: CRC da organização contábil,
  e-mail e telefone institucionais. O texto omite esses trechos até serem preenchidos em
  **Padrões do escritório**.
- Valores assumidos no rascunho da BQRB, a confirmar na tela: cobrança por mês vencido com
  1ª cobrança em 15/10/2026; variáveis da folha até o dia 2; atendimento das 9h às 18h;
  pagamento por boleto ou Pix; retroativo 50% após 90 dias; recálculo R$ 15; faixa
  R$ 100 a cada R$ 50 mil; 13º em 25/11 e 18/12; reajuste pelo IPCA.
- Produção: definir `ZAPSIGN_API_TOKEN` e `ZAPSIGN_WEBHOOK_SECRET`, cadastrar o webhook
  `doc_signed` na ZapSign e conferir `SMTP_*`/`PUBLIC_APP_URL`.
- Bug preexistente de instalação limpa (migrações `ensureEmployeePayrollFields` antes de
  `ensureExtratoAutoSchema`) tratado em sessão separada.
- Arquivos entregues em `Downloads\Contrato`: Word e PDF da BQRB no visual Box, PDF gerado
  pelo portal e exemplo do modelo MEI.
