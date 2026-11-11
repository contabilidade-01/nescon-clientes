# Impostos pendentes no e-CAC — cobrança amigável

**Decisão (revisão de 29/09/2026):** o `central-ecac` puxa a situação fiscal na Receita,
emite guia e cobra o custo SERPRO. **Este portal** é o dono do cliente: contato, canal,
opt-out, janela de envio, lista de números permitidos, histórico e a máquina de estados
da cobrança. Nenhuma mensagem sai do central-ecac; nenhum contato é copiado para lá.

## Revisão de 22/10/2026 (desvio 20) — alerta ao cliente é MANUAL

* O motor (importação, etapas aviso → lembrete → cobranças) continua, mas **toda mensagem
  automática vai só para o escritório** (e para a pessoa da equipe configurada na tela),
  como lembrete. `modo_teste` é fixo em `true`; a chave antiga é ignorada. O link dessas
  mensagens leva ao painel (clique do escritório não conta como clique do cliente).
* **Confirmar pendências** (opcional, por empresa, no detalhe): `POST /api/admin/ecac/empresas/:id/confirmar`
  → central-ecac refaz o relatório de situação fiscal NA HORA (~R$ 0,32; 2/dia; um por vez).
  O painel acompanha em `GET .../confirmacao`; quando chega, o espelho é reimportado (custo
  zero) e as cobranças abertas passam a usar o relatório confirmado.
* **Enviar alerta ao cliente** (permissão `ecac_alerta_cliente`, o dono sempre tem):
  `POST /api/admin/ecac/cobrancas/:id/alertar {canais}` — WhatsApp/e-mail com o texto do
  aviso e um link sem senha **novo, válido por 7 dias** (`ecac_notificacoes.acesso_token`),
  registrado com quem enviou (etapa `alerta-N`). Se o relatório não foi confirmado hoje, a
  tela avisa antes; enviar mesmo assim é permitido.
* **Guias do mês** (G-Click) seguem automáticas: "Chegou a guia no portal" com nome e
  vencimento de cada guia e "Clique aqui para baixar o DAS, o INSS (DCTFWeb) e o FGTS".
  O link vale até o vencimento mais distante + 7 dias; depois do vencimento a tela segue a
  regra do relatório da Receita (recálculo só para empresa liberada no teste).

## Fluxo

```
central-ecac (dia 25, lote pago)  ──▶  espelho ecac_pendencias (importação, custo zero)
        ▲                                        │
        │ POST /reprocessar (N dias úteis)       ▼
        │                              ecac_cobrancas (1 por empresa × mês)
        │                                        │
        │      aberta → notificado → lembrete → cobranca_1 → cobranca_2 → escalado
        │                 │ cliente gerou guia (POST /das/emitir)
        └──────── aguardando_regeracao ──▶ quitado | cobranca_1
```

* **Só cobra o que é válido e em atraso** (`valido`, `em_atraso` vêm do central-ecac) e só
  com relatório do ciclo (`relatorio_recente`). Fantasma do leitor de PDF e relatório
  velho aparecem para o escritório, nunca para o cliente.
* **Regerar relatório é pago**: só depois de o cliente recalcular a guia, no máximo
  `max_regeracoes` por ciclo. Quem não recalculou recebe lembrete.
* **Teto de mensagens** por canal por ciclo, janela 08–19h em dia útil, lista de
  permitidos e teto/hora do WhatsApp — os mesmos dos alertas.
* **Fase de teste — liberação por empresa** (`tool_access.impostos_ecac`, nasce
  desligado): só a empresa liberada em Admin → Empresas → Ferramentas vê a tela
  "Impostos em aberto", gera a guia e recebe as mensagens de cobrança (que mandam gerar
  a guia no portal). As demais continuam no painel `/admin/impostos-ecac`, onde o
  escritório gera a guia de qualquer empresa (mesma rota, `company_id`, mesmas travas).
* **Pausa por empresa** (`companies.ecac_cobranca_ativa`) para negociação, parcelamento
  ou cadastro a corrigir. Abaixo de `alertas_ativos`.

## Onde

| O quê | Onde |
|---|---|
| Regras puras (estados, textos, dias úteis) | `api/src/ecacRegras.js` + `src/test/ecacRegras.test.ts` |
| Cliente HTTP do central-ecac | `api/src/ecacClient.js` |
| Importação do espelho | `api/src/ecacPendencias.js` |
| Envio (e-mail/WhatsApp, fila, modo teste) | `api/src/ecacEnvio.js` |
| Motor + agendador (30 min) | `api/src/ecacCobranca.js` |
| Portal do cliente `/impostos-pendentes` | `src/pages/ImpostosPendentesPage.tsx`, `api/src/routes/ecac.js` |
| Painel `/admin/impostos-ecac` (área `alertas`) | `src/pages/admin/ImpostosEcacPage.tsx`, `api/src/routes/adminEcac.js` |
| Status de entrega do WhatsApp | `api/src/routes/whatsappWebhook.js` (`extrairStatusEntrega`) |
| Schema | `api/src/ensureEcacSchema.js` |

## Segurança

* O CNPJ enviado ao central-ecac é **sempre** o do JWT (`routes/ecac.js`); admin informa
  `company_id` e a empresa é lida do banco. O download do PDF leva o CNPJ e o
  central-ecac recusa se não for o dono.
* O cliente só gera guia de competência que consta no **próprio** relatório.
* Links rastreados (`/api/ecac/r/:token`) e pixel (`/api/ecac/abriu/:token.gif`) usam
  token aleatório sem dado nenhum; a página de destino exige login. Pixel é sinal fraco
  (Gmail/Apple pré-carregam, Outlook bloqueia): o que vale é clique, login e guia gerada.

## Ligar em produção

1. `ECAC_API_URL` + `ECAC_INTEGRACAO_TOKEN` (o mesmo `INTEGRACAO_TOKEN` do central-ecac).
2. Tela **Impostos e-CAC**: conferir "central-ecac respondendo", **Importar agora**.
3. Com **modo teste** ligado e **Enviar mensagens** ligado, rodar **Processar cobranças
   agora**: as mensagens chegam no e-mail/WhatsApp do escritório com o nome da empresa.
4. Conferir texto, valores e links. Só então desligar o modo teste.
5. Ligar **Importar todo mês** (dia 26 por padrão; o lote do central-ecac roda no 25).
