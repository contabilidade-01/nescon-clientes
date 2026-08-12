# Plano — Reconhecimento de vencimento em qualquer documento + IA multi-provedor

## Status: PLANEJADO (não implementado)

Pedido do usuário em 12/08/2026. Este documento é só o plano — nada foi codificado.
**Achado importante**: boa parte do que foi pedido já existe no sistema, construído
para outro fim (CNPJ). Este plano é, em boa parte, **estender e conectar** infra
pronta — não construir do zero. Ver §0 para o inventário do que já existe.

---

## 0. Inventário do que já existe (auditado nesta sessão)

| Peça | Status | Onde |
|---|---|---|
| Boletos Cora com `due_date` | ✅ Pronto, já alerta | `coraSync.js`, `alertas.js` |
| Leitor determinístico de vencimento em PDF | ✅ Pronto, **mas só roda no upload manual** | `pdfDueDate.js` |
| Tela de múltiplos provedores de IA (Claude/Gemini/ChatGPT) | ✅ Pronto e funcional — chave por provedor, teste de conexão real, toggle, limiar de confiança | `ConfigIaPage.tsx` + `api/src/routes/admin.js` (`/config/ia*`) |
| Cascata regex → contexto → IA (para CNPJ) | ✅ Pronto, é o padrão a copiar | `pdfCnpjAi.js` |
| Fallback de IA "legado" via gateway único (Lovable) | ✅ Existe, é o último recurso quando o de cima falha | `pdfIa.js` |
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
