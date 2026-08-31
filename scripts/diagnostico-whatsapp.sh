#!/usr/bin/env bash
# Diagnóstico: o portal NESCON recebe e envia WhatsApp?
# A instância uazapi é a MESMA do sistema de GUIAS. Enviar já existia lá.
# Receber no portal só funciona se o webhook da uazapi apontar para:
#   https://app.gestaoempresa.com/api/whatsapp/webhook[?token=SECRET]
#
# Uso (SSH no Easy / qualquer Bash):
#   bash diagnostico-whatsapp.sh
#   BASE=https://app.gestaoempresa.com bash diagnostico-whatsapp.sh

set -u
BASE="${BASE:-https://app.gestaoempresa.com}"
BASE="${BASE%/}"

echo "============================================================"
echo " Base: $BASE"
echo "============================================================"

echo
echo "=== 1) API no ar? ==="
curl -sS -m 20 "$BASE/api/health" || echo "FALHOU health"
echo

echo "=== 2) Status do assistente (depois do deploy com GET /api/whatsapp/status) ==="
curl -sS -m 25 "$BASE/api/whatsapp/status" || echo "(rota ainda não existe neste deploy)"
echo

echo "=== 3) POST de prova no webhook (fromMe=true — NÃO manda WhatsApp a ninguém) ==="
echo "    HTTP 200 = este servidor ACEITOU o POST"
echo "    HTTP 401 = tem UAZAPI_WEBHOOK_SECRET e este POST não levou ?token=  (a uazapi real precisa da URL com token)"
HTTP=$(curl -sS -m 20 -o /tmp/nescon-wh.json -w "%{http_code}" -X POST "$BASE/api/whatsapp/webhook" \
  -H "Content-Type: application/json" \
  -d "{\"message\":{\"fromMe\":true,\"chatid\":\"5511000000000\",\"messageType\":\"Conversation\",\"text\":\"diagnostico-terminal\",\"messageid\":\"diag-$(date +%s)\"}}")
echo "    HTTP $HTTP  corpo: $(cat /tmp/nescon-wh.json 2>/dev/null)"
echo

echo "=== 4) Dentro do Docker deste servidor (credenciais + webhook NA uazapi) ==="
CID=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -Ei 'api|nescon' | head -1 || true)
if [ -z "${CID:-}" ]; then
  echo "    docker não disponível aqui, ou o nome do container não contém api/nescon."
  echo "    Rode 'docker ps' e depois: docker logs --tail 100 NOME | grep whatsapp-dp"
  exit 0
fi
echo "    container: $CID"
docker exec "$CID" sh -c 'echo "    UAZAPI_SUBDOMAIN=$UAZAPI_SUBDOMAIN"
echo "    UAZAPI_TOKEN=$( [ -n "$UAZAPI_TOKEN" ] && echo preenchido || echo VAZIO )"
echo "    UAZAPI_WEBHOOK_SECRET=$( [ -n "$UAZAPI_WEBHOOK_SECRET" ] && echo preenchido || echo VAZIO )"
echo "    PUBLIC_APP_URL=$PUBLIC_APP_URL"
echo "    OPENAI_API_KEY=$( [ -n "$OPENAI_API_KEY" ] && echo preenchida || echo vazia )"'

SUB=$(docker exec "$CID" printenv UAZAPI_SUBDOMAIN 2>/dev/null || true)
TOK=$(docker exec "$CID" printenv UAZAPI_TOKEN 2>/dev/null || true)
echo
echo "    --- O que a UAZAPI tem cadastrado como webhook (se for URL das GUIAS, o portal não recebe) ---"
if [ -n "$SUB" ] && [ -n "$TOK" ]; then
  curl -sS -m 20 -H "token: $TOK" "https://${SUB}.uazapi.com/webhook" || echo "    GET /webhook falhou"
  echo
  curl -sS -m 20 -H "token: $TOK" "https://${SUB}.uazapi.com/instance/status" || echo "    GET /instance/status falhou"
  echo
else
  echo "    sem SUBDOMAIN/TOKEN no container — envio e leitura do webhook na uazapi impossíveis"
fi

echo
echo "    --- logs recentes whatsapp-dp (vazio = a uazapi não está batendo neste app) ---"
docker logs --tail 150 "$CID" 2>&1 | grep -Ei 'whatsapp-dp|Webhook não autorizado' || echo "    (nenhum log — mensagens não estão chegando neste container)"
echo
echo "Pronto. Interpretação:"
echo "  • Enviar: token uazapi preenchido + instance connected = igual ao sistema de guias."
echo "  • Receber: a URL do GET /webhook TEM que conter /api/whatsapp/webhook deste portal."
echo "    Se a URL for do app de guias, troque no painel uazapi (uma instância = um webhook)."
