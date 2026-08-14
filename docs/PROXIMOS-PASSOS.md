# Próximos passos — Licenças, Taxas anuais e LGPD

Documento de passagem: o que entrou no commit `a2eb3a0`, o que precisa ser feito para colocar no
ar e o que ficou em aberto. A referência técnica completa está no [README](../README.md#painel-do-escritório-uma-página-por-área).

Data: 03/08/2026.

---

## 1. O que já está pronto (commitado e no `main`)

- **Painel do escritório dividido por área**, com menu lateral que retrai. O `/admin` deixou de ser
  uma página só: agora são Visão geral, Empresas, Funcionários, Documentos e entregas, Licenças,
  Taxas anuais, LGPD e Sincronização.
- **Licenças** dos três tipos (funcionamento, AVCB/CLCB, vigilância sanitária) com cadastro manual,
  datas de emissão e vencimento, dashboard clicável e marcação estabelecida × não estabelecida.
- **Taxas anuais da prefeitura**, por empresa e ano: pendente → enviada → confirmada.
- **Consentimento LGPD**: o cliente vê o termo uma vez no primeiro acesso, sem bloquear o portal; o
  escritório acompanha em `/admin/lgpd`.
- Migração roda sozinha no arranque da API. **Nenhum SQL manual no deploy.**

Verificado antes do commit: `npx vitest run` (31/31), `npx vite build` e `npx eslint` limpos.

---

## 2. Colocar no ar

1. **Redeploy** do serviço Compose do `nescon-clientes` no Easypanel (se o Auto Deploy estiver
   ligado, o push já disparou).
2. No arranque, o log da API deve mostrar:

   ```
   [DB] licencas/taxas/LGPD: tabelas verificadas/criadas.
   ```

   Se não aparecer, a migração falhou e o resto não vai funcionar — o erro sai logo abaixo, no
   mesmo log, com o código do Postgres.
3. Nada mais. Não é preciso mexer em variáveis: `LICENSE_WARN_DAYS` só existe se você quiser mudar
   os 60 dias de antecedência do aviso.

---

## 3. Validar depois do deploy (10 minutos)

| # | O que fazer | O que tem de acontecer |
|---|-------------|------------------------|
| 1 | Entrar em `/admin` | Menu lateral aparece; o botão no topo retrai para ícones e volta |
| 2 | Abrir cada item do menu | Todas as páginas carregam sem erro |
| 3 | `/admin/licencas` → **Nova licença** | Cadastrar uma licença com vencimento **no mês que vem** |
| 4 | Voltar ao painel | Ela conta em **A vencer**; clicar no número filtra a lista |
| 5 | Cadastrar outra com vencimento no ano passado | Conta em **Vencidas** |
| 6 | Aba **Empresas estabelecidas** | Desmarcar uma empresa: ela some do painel e das taxas anuais |
| 7 | `/admin/taxas-anuais` | Marcar uma empresa como *enviada*; o número no topo muda |
| 8 | Entrar no portal como um **cliente que ainda não viu o aviso** | O termo LGPD abre uma vez; aceitar |
| 9 | `/admin/lgpd` | A empresa aparece como **Aceito**, com data e versão |
| 10 | Sair e entrar de novo como esse cliente | O aviso **não** volta |

Se o passo 8 não mostrar nada, confirme que a empresa nunca respondeu: a coluna
`companies.lgpd_prompt_seen_at` precisa estar nula.

---

## 4. Trabalho de cadastro (é aqui que está o esforço real)

O sistema está pronto, mas **nasce vazio de licenças**. O que precisa ser feito uma vez:

1. **Marcar quem não é estabelecida.** Toda empresa nasce como estabelecida — foi a escolha
   conservadora, para nenhuma sumir do controle sem alguém mandar. Passe em
   *Licenças → Empresas estabelecidas* e desmarque as que não têm ponto físico. Elas saem do painel
   de licenças e do controle de taxa anual.
2. **Cadastrar as licenças existentes**, empresa por empresa. O mínimo é a **data de vencimento** —
   número, órgão e emissão são opcionais e podem entrar depois.
3. Empresa estabelecida **sem** licença cadastrada aparece como **Sem licença** no painel. Isso é
   proposital: é a lista de trabalho, não um erro.

Sugestão de ordem: comece pelos alvarás de funcionamento (todas têm), depois AVCB/CLCB, depois
sanitária (só quem precisa — alimentação, saúde, estética).

---

## 5. Decisões em aberto

- **Texto do LGPD.** O que está no ar é o rascunho que combinamos. Vale passar pelo jurídico antes
  de valer como consentimento formal. Ao mudar o texto, altere também a versão
  (`LGPD_CONSENT_VERSION` em `api/src/lgpd.js`) — os aceites já dados continuam registrados com a
  versão da época, que é o que dá valor à auditoria.
- **Padrão do `established`.** Hoje toda empresa nasce estabelecida. Se na prática a maioria dos
  clientes não for estabelecida, é melhor inverter (nascer desmarcada) — é uma linha de código.
- **Janela de 60 dias.** Se para AVCB o prazo de renovação exigir mais folga, dá para (a) mudar o
  valor global em `LICENSE_WARN_DAYS` ou (b) passar a ter uma janela por tipo de licença. A segunda
  opção é uma mudança pequena em `licenseStatus.js`.

---

## 6. Em fila: cadastro de clientes vindos do G-Click

Planejado e documentado em **[PLANO-CLIENTES-GCLICK.md](PLANO-CLIENTES-GCLICK.md)** — ainda **não
implementado**. Resumo: a sync deixa de criar empresa sozinha; cliente novo vira **alerta** para o
admin decidir (cadastrar ou rejeitar, com lista de rejeitados), mudança de status vira **aviso** com
OK, e o cadastro passa a ser nosso — o G-Click só informa entradas e inativações.

## 7. Anotado, para fazer depois do plano do G-Click

Duas coisas que o Jean pediu para **registrar agora e executar depois** — nesta ordem, depois de
concluído o [PLANO-CLIENTES-GCLICK.md](PLANO-CLIENTES-GCLICK.md).

### 7.1 Login do Nelson — **infraestrutura PRONTA, falta criar o usuário**

O acesso por CPF com permissão por área foi implementado (ver
[README](../README.md#usuários-do-painel-e-acesso-por-área)). Só falta o cadastro em si, que é
trabalho de tela, não de código:

1. Entrar como dono em **`/admin/usuarios`**.
2. **Novo usuário**: nome e CPF do Nelson.
3. Marcar as áreas dele. Sugestão inicial: **Licenças** e **Taxas anuais**; ajusta depois sem
   precisar recriar nada.
4. **Criar usuário** → o sistema mostra a senha inicial **uma vez**. Anotar e passar por canal
   seguro (não colocar no repositório). Ele troca no primeiro acesso, obrigatoriamente.

### 7.2 Aviso automático de vencimento por WhatsApp (DAS, FGTS, INSS)

Mandar mensagem ao cliente **1 dia antes** do vencimento das guias de DAS, FGTS e INSS.

**Pré-requisito inegociável, e é aqui que mora o risco:** precisamos ter **certeza absoluta de que
o vencimento está sendo capturado corretamente**. Hoje o vencimento vem de `extrairVencimento()`
(`api/src/pdfDueDate.js`), que lê a data do **PDF**, e só cai para a data do G-Click se a leitura
falhar — justamente porque o G-Click erra em alguns casos (FGTS Digital é o exemplo conhecido).
Uma data errada aqui não é um detalhe de tela: vira uma mensagem errada no WhatsApp do cliente, e
o erro só aparece depois que o dano está feito.

Antes de escrever uma linha do disparo, fazer uma **auditoria de vencimentos**:

1. Relatório no admin listando, por tipo de documento, a data lida do PDF × a data do G-Click, com
   destaque para as divergentes e para as que ficaram nulas.
2. Conferir uma amostra à mão, por tipo (DAS, FGTS, INSS) — são leiautes diferentes, e o parser
   pode acertar num e errar noutro.
3. Só liberar o disparo automático para os tipos com 100% de acerto na amostra. Tipo que não passar
   fica de fora até o parser ser corrigido.

Só depois disso: rotina diária que busca vencimentos de amanhã e dispara pela uazapi (a mesma
infraestrutura do sistema de guias), com registro do que foi enviado para não mandar duas vezes.
Vale prever também um "não perturbe" por empresa.

## 8. Independência do G-Click (fases futuras)

Documentado em **[PLANO-INDEPENDENCIA-GCLICK.md](PLANO-INDEPENDENCIA-GCLICK.md)**: reconhecer o
documento no upload manual (identifica a empresa por CNPJ → CPF → nome e o tipo, aloca sozinho com
aviso quando houver divergência), segunda esteira vinda do **Central Pendências e-CAC** (DAS e DARF
DCTFWeb, que aquele sistema já emite em lote) e **parcelamentos** — Prefeitura, PGFN e Receita, que
hoje **não existem** no portal.

## 9. Férias na palma da mão do cliente

Planejado em **[PLANO-FERIAS.md](PLANO-FERIAS.md)**: previsão de férias, custo (férias +
1/3 + FGTS) e limite de faltas, trazidos do app anterior. Entra por upload da
Programação de Férias — o G-Click não expõe isso na API hoje. Sem tela nova de admin: o
upload fica dentro de `/admin/empresas`.

## 10. Ideias para depois (não estão feitas)

Em ordem de utilidade, na minha leitura:

1. **Aviso automático de vencimento**: e-mail ou WhatsApp ao cliente quando a licença entra na
   janela dos 60 dias. A infraestrutura de WhatsApp já existe no sistema de guias (uazapi).
2. **Anexar o PDF da licença** ao cadastro, reaproveitando o upload que já existe em entregas.
3. **Mostrar a licença ao cliente** no portal (hoje é só visão do escritório).
4. **Exportar a lista** de vencidas / a vencer em Excel, para reunião.
5. **Vincular a taxa anual à guia** já entregue pelo G-Click, em vez de marcação manual — depende
   de o G-Click identificar essa guia de forma confiável.
