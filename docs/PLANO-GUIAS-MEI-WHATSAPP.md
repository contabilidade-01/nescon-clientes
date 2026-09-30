# Guias do MEI pelo WhatsApp — mapa de possibilidades

**Data:** 30/09/2026 · **Escopo:** (A) DAS MEI mensal e (B) parcelas de parcelamento do MEI
(PARCMEI, PERTMEI, RELPMEI), entregues automaticamente ao cliente pelo WhatsApp.
**Base:** código atual de `central-ecac` e `nescon-clientes`, já com a integração
`/api/interno` e a cobrança de pendências do e-CAC em produção.

---

## 1. O que já existe e serve de base

### central-ecac (SERPRO)
| Peça | Situação |
|---|---|
| DAS MEI | `PGMEI/GERARDASPDF21` por competência (R$ 0,32). Avulso, em lote ("DAS Lote", tipo MEI) e pela API interna. PDF guardado em `das_emissoes` e exposto em `GET /api/interno/das/emissoes` e `/das/<id>/pdf`. |
| Parcelamentos MEI | Três tipos: `PARCMEI` (203/202/201), `PERTMEI` (223/222/221), `RELPMEI` (233/232/231). `PEDIDOSPARC` lista o pedido; `PARCELASPARAGERAR` com `parcelaParaEmitir=true` **já devolve o PDF da parcela**; PDF salvo em `parcelas/<company_id>/` e registrado em `parcelamentos_parcelas` (vencimento, valor, caminho). Rota `GET /api/parcelamentos/pdf/<id>` e "ZIP das parcelas de hoje". |
| Agendamento | Módulo `parcelamentos` existe (desligado por padrão) mas só busca **pedidos**; buscar **parcelas com PDF** é ação de tela. Não há módulo agendável para DAS MEI. |
| Quem é MEI | O relatório de situação fiscal traz "Opção pelo SIMEI" (`relatorios_sitfiscal.simei_inclusao/exclusao`). Pedido de parcelamento MEI ativo também identifica. Flags por empresa `consultar_parc_mei`, `consultar_pert_mei`, `consultar_relp_mei`. |
| Travas | Teto mensal, mapa de procurações, checkpoint por empresa, limite diário de emissão — todas reaproveitáveis. |

### nescon-clientes (portal + WhatsApp)
| Peça | Situação |
|---|---|
| Anexo no WhatsApp | `uazapi.enviarDocumento({ fileUrl, docName, caption })` — usado hoje por boletos Cora e honorários. Exige **URL pública** do PDF; a uazapi baixa o arquivo. |
| URL pública sem login | `deliverables.access_token` + `GET /api/deliverables/public/:token/file` (só com `released_at`), página `/entrega/:token`, `noindex`. É o mecanismo que já entrega guia ao cliente. |
| Aviso de documento novo | `docNotify.js`: WhatsApp texto + link, janela 08–19h, fila das 07:50, teto/hora, lista de permitidos, opt-out do cliente (`avisos_documentos_ativos`). Hoje **não anexa o PDF**. |
| Alerta de vencimento | Catálogo `obrigacoes.js`: DAS dia 20 (aviso D-1) — não distingue MEI de Simples e **não tem obrigação "parcelamento"**. |
| G-Click | Tipo `DAS` vira categoria `guia`; se o escritório gerar DAS MEI no Domínio/G-Click, ele já chega ao portal e já dispara o aviso. Não existe tipo "parcelamento". |
| Cofre MEI | `mei_credentials` guarda login do Portal do Empreendedor para **NF do MEI**; não serve para DAS (a API SERPRO já resolve). |
| Integração nova | `ecacClient.js`, modo teste, eventos, tela admin — reaproveitáveis. |

---

## 2. Fluxo A — DAS MEI mensal

O DAS da competência M pode ser gerado a partir do dia 1 de M+1 e vence dia 20 de M+1.

### A1 · Emissão pelo central-ecac + entrega no portal + WhatsApp com anexo — **recomendada**
1. **central-ecac:** módulo agendável novo `das_mei` (dia 1–5, mensal, dia útil): para cada empresa **MEI ativa** (SIMEI com inclusão e sem exclusão no último relatório, ou flag manual), emite `GERARDASPDF21` da competência anterior. Reaproveita teto, procuração, checkpoint e `das_emissoes` (origem `lote_mei`). Custo: R$ 0,32 por MEI por mês.
2. **API interna:** já existe (`/das/emissoes?desde=` + `/das/<id>/pdf`). Só acrescentar filtro `tipo=MEI` e `origem`.
3. **nescon-clientes:** "importador de guias" (job a cada hora): busca emissões novas, baixa o PDF para `uploads/`, cria `deliverable` (`category='guia'`, `doc_type='DAS'`, `competencia`, `due_date` = dia 20, `source='central-ecac'`, `external_ref=emissao_id` → idempotente), `released_at=now`, `access_token`.
4. **Envio:** `enviarDocumento` com `fileUrl = PUBLIC_APP_URL/api/deliverables/public/<token>/file`, `caption` com competência, vencimento e valor, dentro das regras do `docNotify` (janela, fila, opt-out, teto/hora). Fallback: texto + link se o anexo falhar; e-mail com anexo para quem não tem WhatsApp válido.
5. **Bônus grátis:** o alerta D-1 de DAS passa a valer (`das_no_portal`), e o cliente vê a guia em "Guias fiscais" e em "Próximos pagamentos".

Esforço: ~2 dias (1 no central-ecac, 1 no portal + testes). Risco baixo: tudo é composição de peças existentes.

### A2 · Sem SERPRO: Domínio/G-Click gera o DAS MEI, portal só anexa
O escritório continua gerando no Domínio; o G-Click já traz o PDF; muda-se só o `docNotify` para anexar o PDF (`enviarDocumento`) em vez de mandar só link. Custo SERPRO zero, esforço ~meio dia, mas **depende do trabalho manual mensal** no Domínio e do G-Click estar em dia. Serve como plano B e como melhoria imediata do aviso de documento para todas as guias.

### A3 · Sob demanda no portal
Estender `/impostos-pendentes` para "DAS do mês" (hoje só mostra débito em atraso). Não é envio automático; complemento do A1 para quem perdeu o PDF.

### A4 · Só link, sem anexo
Mais simples, mas o cliente precisa abrir o link; anexo é o que ele espera "no WhatsApp". Recomendo anexo **e** link.

**Decisão a tomar:** fonte única do DAS MEI. Se o Domínio/G-Click e o central-ecac gerarem, o cliente recebe dois. Ou desliga-se o DAS MEI no G-Click, ou o importador deduplica por `company_id + doc_type + competencia`.

---

## 3. Fluxo B — Parcelas de parcelamento do MEI

### B1 · Rotina mensal no central-ecac + mesmo pipeline do A1 — **recomendada**
1. **central-ecac:** ampliar o módulo `parcelamentos` (ou criar `parcelas_mei`) para, nas empresas com **pedido ativo** de tipo MEI, chamar `PARCELASPARAGERAR` com `parcelaParaEmitir=true` (traz o PDF da parcela) no início do mês (dia 1–5). Hoje isso é ação de tela; vira agendável com teto e checkpoint. Custo: 1 consulta (R$ 0,24) por tipo ativo por empresa.
2. **API interna nova:** `GET /api/interno/parcelas?desde=&tipo=` (lê `parcelamentos_parcelas`) e `GET /parcelas/<id>/pdf?cnpj=` (recorte por CNPJ como no DAS).
3. **nescon-clientes:** o mesmo importador cria `deliverable` (`doc_type='PARCELAMENTO_MEI'`, `title` "Parcela X/Y — PARCMEI", `due_date` = vencimento da parcela, `external_ref='parcela:<id>'`) e envia pelo WhatsApp com anexo e caption (tipo, parcela, vencimento, valor).
4. **Catálogo:** incluir `PARCELAMENTO_MEI` em `gclick/guides.js`/`obrigacoes.js` com regra "vencimento vem do documento" (não há dia fixo em lei — o vencimento é o da parcela), para o alerta D-1 e para o calendário.

Esforço: ~2 a 3 dias. Ponto a **validar em produção com uma empresa**: o `PARCELASPARAGERAR` devolve só a parcela do mês ou também as em atraso, e se uma parcela já paga sai da lista. Isso define se precisa de filtro "não reenviar parcela já enviada".

### B2 · Sob demanda no portal
Listar as parcelas do espelho e botão "gerar parcela" (`GERARDAS201/221/231`), igual ao DAS em atraso. Complemento do B1.

---

## 4. Base comum (construir uma vez)

| Item | Onde | Observação |
|---|---|---|
| Identificar MEI ativa | central-ecac | SIMEI no relatório + flag manual `mei` por empresa (para quem ainda não tem relatório) |
| Módulo agendável "guias MEI" | central-ecac | DAS + parcelas, mesmo dia, teto, checkpoint, retomada |
| Endpoints internos de parcelas | central-ecac | espelhar o que já existe para DAS |
| Importador de guias | nescon | emissão/parcela → `deliverable` idempotente → release → fila de envio |
| Anexo no WhatsApp | nescon | `enviarDocumento` dentro das regras do `docNotify`; fallback texto+link; fallback e-mail |
| Dedupe e fonte única | nescon | `company_id + doc_type + competencia`; decidir G-Click × central-ecac |
| Modo teste e painel | nescon | reaproveitar o modo teste do e-CAC; tela com "enviadas / falhas / sem WhatsApp"; `deliverables.alert_sent_at` já existe |
| Segurança | nescon | token público longo (já), `noindex` (já); opcional: expirar o link 30 dias após o vencimento |
| Quem deixou de ser MEI | central-ecac | `simei_exclusao` preenchida → não emite; a SERPRO recusa e o mapa de procurações trava a empresa |

---

## 5. Custo estimado (mensal)

| Item | Unitário | 30 MEIs | 60 MEIs |
|---|---|---|---|
| DAS MEI (emissão) | R$ 0,32 | R$ 9,60 | R$ 19,20 |
| Parcelas (consulta por tipo ativo) | R$ 0,24 | R$ 2,40 (10 c/ parcelamento) | R$ 4,80 |
| **Total** | | **~R$ 12** | **~R$ 24** |

WhatsApp: a uazapi não cobra por mensagem; vale o teto/hora já configurado.

---

## 6. Riscos e pontos de validação

1. **Duplicidade com o G-Click** (ver decisão de fonte única).
2. **Parcela já paga** na lista da SERPRO — validar antes de automatizar o envio.
3. **URL pública acessível pela uazapi** — `PUBLIC_APP_URL` tem de resolver de fora; já é o caso dos boletos.
4. **Cliente sem WhatsApp válido** — hoje o aviso é ignorado; propor fallback por e-mail com anexo (SMTP já existe).
5. **DAS MEI com data de consolidação** (vencido) — continua dependendo da validação em produção já anotada na integração do e-CAC; para o DAS do mês não é preciso.
6. **Empresa MEI sem procuração** — a SERPRO recusa; o mapa de procurações já trava e o painel mostra.

---

## 7. Recomendação e ordem

1. **Fase 1 — DAS MEI (A1)**, com o anexo no `docNotify` (que já melhora todas as guias) e decisão de fonte única. Primeira rodada em modo teste (tudo para o escritório).
2. **Fase 2 — Parcelas (B1)**, depois de validar com uma empresa o que a SERPRO devolve.
3. **Fase 3 — Portal**: DAS do mês e "gerar parcela" sob demanda; fallback por e-mail; painel de envios.

Antes de começar, preciso de três respostas: (1) o DAS MEI hoje é gerado no Domínio/G-Click ou não? (2) quantas empresas MEI e quantas com parcelamento ativo? (3) o envio deve ir só para o WhatsApp da empresa ou também para um segundo número (sócio)?
