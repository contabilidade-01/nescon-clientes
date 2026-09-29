# Impostos pendentes no e-CAC — cobrança amigável

**Decisão (revisão de 29/09/2026):** o `central-ecac` puxa a situação fiscal na Receita,
emite guia e cobra o custo SERPRO. **Este portal** é o dono do cliente: contato, canal,
opt-out, janela de envio, lista de números permitidos, histórico e a máquina de estados
da cobrança. Nenhuma mensagem sai do central-ecac; nenhum contato é copiado para lá.

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
