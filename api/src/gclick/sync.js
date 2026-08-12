/**
 * Puxa os documentos do G-Click para o portal.
 *
 * O portal é independente do sistema de guias: busca direto na API do G-Click,
 * guarda o PDF e sempre mantém a ÚLTIMA versão de cada documento (retificação
 * atualiza a linha em vez de criar outra — ver `chaveDocumento`).
 *
 * Documento novo entra JÁ LIBERADO (`released_at` preenchido na hora) e o aviso por
 * WhatsApp sai DAQUI MESMO, no fim da sincronização — ver `docNotify.js`. Não depende
 * mais do sistema de guias (GCLICK) chamar nada: antes o aviso saía só quando o GCLICK
 * chamava POST /api/fiscal/release e decidia mandar do lado dele; com o GCLICK pausado,
 * essa ponta nunca era chamada e o cliente parava de ser avisado sem nenhum erro
 * aparecer em lugar nenhum. Ver docs/ESTADO-E-PROXIMO-PASSO.md.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const db = require("../db");
const client = require("./client");
const clientSync = require("./clientSync");
const extratoAuto = require("../extratoAuto");
const {
  classificar,
  categoriaDe,
  extrairGuiasPendentes,
  rangeCompetencia,
  ultimasCompetencias,
} = require("./guides");
const { UPLOAD_DIR } = require("../uploads");
const { extrairVencimento } = require("../pdfDueDate");
const { PORTAL_ONLY_TOOL_ACCESS } = require("../companyTools");
const { gerarSenhaInicial } = require("../senhaInicial");
const { notificarDocumentosNovos } = require("../docNotify");

const MESES_PADRAO = Number(process.env.GCLICK_SYNC_MESES || 6);
const CONCORRENCIA_TAREFAS = 8;
const CONCORRENCIA_DOCS = 4;

let emExecucao = false;
let ultimoResultado = null;

function estaRodando() {
  return emExecucao;
}
function ultimaExecucao() {
  return ultimoResultado;
}

function gravarPdf(buffer, nomeOriginal) {
  const safe = String(nomeOriginal || "documento.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${safe}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buffer);
  return fileName;
}

function removerPdf(fileName) {
  if (!fileName) return;
  const full = path.resolve(UPLOAD_DIR, path.basename(fileName));
  if (full.startsWith(path.resolve(UPLOAD_DIR)) && fs.existsSync(full)) {
    try {
      fs.unlinkSync(full);
    } catch (err) {
      console.error("[sync] falha ao remover PDF antigo:", err.message);
    }
  }
}

/** CNPJ → company_id, criando as empresas que faltam com os nomes do G-Click. */
async function mapaEmpresas(cnpjsNecessarios) {
  const { rows } = await db.query("SELECT id, cnpj FROM companies");
  const mapa = new Map(rows.map((r) => [r.cnpj, r.id]));

  const faltando = [...cnpjsNecessarios].filter((c) => c && !mapa.has(c));
  if (!faltando.length) return { mapa, criadas: 0 };

  // Só busca a lista de clientes se realmente falta alguém (evita chamada à toa).
  let nomes = new Map();
  try {
    const clientes = await client.listarClientes();
    nomes = new Map(
      clientes
        .map((c) => client.extrairDadosCliente(c))
        .filter((c) => c.cnpj)
        .map((c) => [c.cnpj, c])
    );
  } catch (err) {
    console.error("[sync] não consegui listar clientes do G-Click:", err.message);
  }

  let criadas = 0;
  for (const cnpj of faltando) {
    const dados = nomes.get(cnpj);
    const nome = dados?.name || `Empresa ${cnpj}`;
    try {
      // Senha inicial ALEATÓRIA. Ninguém a vê aqui — a empresa nasce pela sincronização,
      // sem gente na frente. O acesso se dá por "esqueci minha senha" (o e-mail vem do
      // G-Click) ou pelo botão de gerar senha no painel. Usar o CNPJ, que é público,
      // deixava a conta aberta a quem soubesse o número.
      const { rows: novo } = await db.query(
        `INSERT INTO companies
           (name, cnpj, password_hash, contact_email, tool_access, must_change_password)
         VALUES ($1,$2,$3,$4,$5::jsonb,true)
         ON CONFLICT (cnpj) DO NOTHING
         RETURNING id`,
        [nome, cnpj, await bcrypt.hash(gerarSenhaInicial(), 10), dados?.email || null,
         JSON.stringify(PORTAL_ONLY_TOOL_ACCESS)]
      );
      if (novo.length) {
        mapa.set(cnpj, novo[0].id);
        criadas++;
      } else {
        const { rows: ja } = await db.query("SELECT id FROM companies WHERE cnpj = $1", [cnpj]);
        if (ja.length) mapa.set(cnpj, ja[0].id);
      }
    } catch (err) {
      console.error("[sync] falha ao criar empresa", cnpj, err.message);
    }
  }
  return { mapa, criadas };
}

/**
 * Grava (ou atualiza) uma guia.
 * Devolve `{ status, title, competencia }` — status: 'criado' | 'atualizado' | 'sem-mudanca' | 'erro'.
 * `title`/`competencia` só importam para 'criado' (é o que alimenta o aviso de documento novo).
 */
async function gravarGuia(guia, companyId, { historico = false } = {}) {
  const cls = classificar(guia.arquivoNome, guia.atividadeNome, guia.obrigacaoNome);
  const docType = cls?.codigo || null;
  const categoria = categoriaDe(docType);
  const titulo = cls?.nome || guia.arquivoNome || guia.atividadeNome || "Documento";

  const { rows: existentes } = await db.query(
    `SELECT id, file_path, gclick_versao_em
     FROM deliverables WHERE company_id = $1 AND external_ref = $2`,
    [companyId, guia.chave]
  );
  const atual = existentes[0];

  // Mesma versão já guardada: não rebaixa o PDF nem toca na linha.
  if (atual && atual.gclick_versao_em && atual.gclick_versao_em === (guia.respondidaEm || "")) {
    return { status: "sem-mudanca" };
  }
  if (!guia.arquivoUrl) return { status: "erro" };

  const pdf = await client.baixarPdf(guia.arquivoUrl);

  // Vencimento: o do PDF manda (o do G-Click erra sistematicamente, ex. FGTS Digital).
  let dueDate = null;
  if (cls?.temVencimento !== false) {
    dueDate = await extrairVencimento(pdf);
    if (!dueDate && guia.dataVencimento) dueDate = String(guia.dataVencimento).slice(0, 10);
  }

  const fileName = gravarPdf(pdf, guia.arquivoNome);

  if (atual) {
    await db.query(
      `UPDATE deliverables
       SET category=$1, doc_type=$2, title=$3, competencia=$4, due_date=$5,
           file_path=$6, file_name=$7, gclick_versao_em=$8, gclick_atividade_id=$9,
           num_versoes=$10, source='gclick'
       WHERE id=$11`,
      [categoria, docType, titulo, guia.competencia || null, dueDate,
       fileName, guia.arquivoNome || fileName, guia.respondidaEm || "",
       String(guia.atividadeId || ""), guia.numVersoes || 1, atual.id]
    );
    removerPdf(atual.file_path);
    return { status: "atualizado" };
  }

  // Documento novo entra JÁ LIBERADO: se o G-Click tem o arquivo pronto, o cliente
  // pode ver. Não depende mais do sistema de guias chamar /api/fiscal/release.
  await db.query(
    `INSERT INTO deliverables
       (company_id, category, doc_type, title, competencia, due_date,
        file_path, file_name, source, external_ref, access_token,
        gclick_versao_em, gclick_atividade_id, num_versoes, historico, released_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'gclick',$9,$10,$11,$12,$13,$14, now())`,
    [companyId, categoria, docType, titulo, guia.competencia || null, dueDate,
     fileName, guia.arquivoNome || fileName, guia.chave,
     crypto.randomBytes(24).toString("hex"), guia.respondidaEm || "",
     String(guia.atividadeId || ""), guia.numVersoes || 1, historico]
  );
  return { status: "criado", title: titulo, competencia: guia.competencia || null };
}

/**
 * Regulariza o que JÁ ESTAVA no banco daquelas competências.
 *
 * `gravarGuia` só marca `historico` no INSERT. Mas a sincronização normal roda há meses
 * com `GCLICK_SYNC_MESES=6`, então boa parte do período pedido **já existe** — e essas
 * linhas ficariam de fora da marcação, retidas e com vencimento vencido. Bastaria alguém
 * liberá-las para o cliente ver um punhado de guias em vermelho.
 *
 * Só toca no que está **retido**: documento retido nunca foi mostrado ao cliente, então
 * tratá-lo como arquivo é dizer a verdade. Documento já liberado foi entregue como
 * cobrança de verdade e continua como está — esconder isso poderia apagar uma dívida
 * real da vista do cliente.
 */
async function regularizarHistorico(competencias, tipos = null) {
  // Respeita o filtro de tipo: pedir só a folha não pode liberar as guias de tabela.
  const { rowCount } = await db.query(
    `UPDATE deliverables
        SET historico = true, released_at = now()
      WHERE competencia = ANY($1)
        AND released_at IS NULL
        AND source = 'gclick'
        AND ($2::text[] IS NULL OR doc_type = ANY($2::text[]))`,
    [competencias, tipos && tipos.length ? tipos : null]
  );
  if (rowCount) console.log(`[sync] histórico: ${rowCount} documento(s) já existentes regularizados.`);
  return rowCount;
}

/**
 * Sincroniza as competências pedidas (padrão: últimos GCLICK_SYNC_MESES meses).
 * `cnpj` limita a uma empresa — usado na liberação, para trazer o dado fresco antes
 * de publicar sem varrer a base toda.
 * `notificar` (padrão: liga sozinho fora de carga histórica) manda o WhatsApp de
 * "documento novo" por empresa no fim — desligar é para carga em massa/histórica, onde
 * o volume de documento "novo" não é chegada de verdade.
 */
async function sincronizar({
  meses = MESES_PADRAO,
  competencias = null,
  cnpj = null,
  historico = false,
  tipos = null,
  // Carga histórica nunca avisa (documento de arquivo, não chegada nova) — e quem chama
  // pode desligar explicitamente também, caso da carga inicial de portal vazio (senão
  // seria um WhatsApp por cliente avisando de meses de documento antigo de uma vez).
  notificar = !historico,
} = {}) {
  if (!client.isConfigured()) {
    return { ok: false, erro: "G-Click não configurado (GCLICK_CLIENT_ID/SECRET)" };
  }
  if (emExecucao) return { ok: false, erro: "Já existe uma sincronização em andamento" };

  emExecucao = true;
  const inicio = Date.now();
  const total = { criados: 0, atualizados: 0, semMudanca: 0, erros: 0, empresasCriadas: 0 };
  const comps = competencias || ultimasCompetencias(meses);
  const cnpjFiltro = cnpj ? String(cnpj).replace(/\D/g, "") : null;
  // Documentos criados nesta rodada, agrupados por empresa — vira UM aviso por empresa
  // no fim, não um por documento (senão dez guias no mesmo dia viram dez mensagens).
  const novosPorEmpresa = new Map();

  try {
    // Carga completa também atualiza o espelho de clientes (novos e mudanças de
    // status viram alertas no painel). Fica de fora quando a sync é de uma empresa
    // só — nesse caso ela roda na liberação de um documento e precisa ser rápida.
    if (!cnpjFiltro) {
      const r = await clientSync.sincronizarClientes();
      if (!r.ok) console.error("[sync] clientes:", r.erro);
    }

    for (const comp of comps) {
      const { inicio: dIni, fim: dFim } = rangeCompetencia(comp);
      let tarefas;
      try {
        tarefas = await client.listarTarefasObrigacoes({
          dataVencimentoInicio: dIni,
          dataVencimentoFim: dFim,
        });
      } catch (err) {
        console.error(`[sync] ${comp}: falha ao listar tarefas —`, err.message);
        total.erros++;
        continue;
      }

      console.log(`[sync] ${comp}: ${tarefas.length} tarefa(s) do G-Click`);

      if (cnpjFiltro) {
        tarefas = tarefas.filter(
          (t) => String(t?.clienteInscricao || "").replace(/\D/g, "") === cnpjFiltro
        );
      }
      if (!tarefas.length) continue;

      const listas = await client.mapLimit(tarefas, CONCORRENCIA_TAREFAS, async (t) => {
        try {
          return extrairGuiasPendentes(t, await client.listarAtividades(t.id));
        } catch (err) {
          console.error(`[sync] atividades da tarefa ${t.id}:`, err.message);
          total.erros++;
          return [];
        }
      });
      let guias = listas.flat().filter((g) => g.cnpj && g.arquivoUrl);

      console.log(`[sync] ${comp}: ${listas.flat().length} atividade(s), ${guias.length} guia(s) com arquivo`);

      // Filtro por TIPO de documento. Existe para a carga poder ser cirúrgica: trazer só
      // o Extrato da Folha de um ano inteiro é barato e alimenta os indicadores, enquanto
      // trazer todas as guias do mesmo período seria dez vezes o volume para nada.
      // O que não casa com nenhum tipo conhecido fica de fora quando há filtro — na
      // dúvida, não baixar é mais barato que baixar errado.
      if (tipos && tipos.length) {
        const querido = new Set(tipos);
        guias = guias.filter((g) => {
          const cls = classificar(g.arquivoNome, g.atividadeNome, g.obrigacaoNome);
          return cls && querido.has(cls.codigo);
        });
      }
      if (!guias.length) continue;

      const { mapa, criadas } = await mapaEmpresas(new Set(guias.map((g) => g.cnpj)));
      total.empresasCriadas += criadas;

      await client.mapLimit(guias, CONCORRENCIA_DOCS, async (g) => {
        const companyId = mapa.get(g.cnpj);
        if (!companyId) {
          total.erros++;
          return;
        }
        try {
          const r = await gravarGuia(g, companyId, { historico });
          if (r.status === "criado") {
            total.criados++;
            if (!novosPorEmpresa.has(companyId)) novosPorEmpresa.set(companyId, []);
            novosPorEmpresa.get(companyId).push({ title: r.title, competencia: r.competencia });
          } else if (r.status === "atualizado") total.atualizados++;
          else if (r.status === "sem-mudanca") total.semMudanca++;
          else total.erros++;
        } catch (err) {
          console.error("[sync] guia", g.chave, err.message);
          total.erros++;
        }
      });

      console.log(
        `[sync] ${comp}: ${guias.length} guia(s) — ` +
          `${total.criados} novas, ${total.atualizados} atualizadas até agora`
      );
    }

    // Na carga histórica, regulariza também o que já estava no banco daquelas
    // competências — senão metade do período pedido ficaria de fora da marcação.
    if (historico) total.regularizados = await regularizarHistorico(comps, tipos);

    // Extratos novos entram sozinhos: cadastra/atualiza funcionários (código e
    // salário) e transforma saídas em aviso. Só na carga completa.
    if (!cnpjFiltro) {
      const e = await extratoAuto.processarExtratos(db);
      if (!e.ok) console.error("[sync] extratos:", e.erro);
    }

    // Liberar quaisquer documentos retidos que ainda existam (legado da época em que
    // o portal dependia do GCLICK chamar /api/fiscal/release). Agora tudo entra liberado,
    // mas pode haver resíduos de syncs anteriores.
    const { rowCount: liberados } = await db.query(
      `UPDATE deliverables SET released_at = now()
       WHERE source = 'gclick' AND released_at IS NULL`
    );
    if (liberados) {
      total.liberados = liberados;
      console.log(`[sync] ${liberados} documento(s) retido(s) liberado(s) automaticamente.`);
    }

    // Aviso de documento novo — direto do portal, sem depender do sistema de guias
    // (ver docNotify.js). Sequencial (não Promise.all): reusa o mesmo teto/hora do
    // envio de alertas de vencimento, e paralelizar N chamadas de uma vez estouraria
    // esse teto de propósito.
    if (notificar && novosPorEmpresa.size) {
      total.avisos_enviados = 0;
      total.avisos_nao_enviados = 0;
      for (const [companyId, docs] of novosPorEmpresa) {
        const r = await notificarDocumentosNovos(db, companyId, docs);
        if (r.enviado) total.avisos_enviados++;
        else {
          total.avisos_nao_enviados++;
          console.log(`[sync] aviso de documento novo não enviado (${companyId}): ${r.motivo}`);
        }
      }
    }

    ultimoResultado = {
      ...total,
      competencias: comps,
      segundos: Math.round((Date.now() - inicio) / 1000),
      em: new Date().toISOString(),
    };
    console.log("[sync] concluído:", JSON.stringify(ultimoResultado));
    return { ok: true, ...ultimoResultado };
  } finally {
    emExecucao = false;
  }
}

/**
 * Agendamento periódico (GCLICK_SYNC_INTERVAL_H; 0 = desligado) + 1ª carga no arranque.
 *
 * Sem a carga inicial, o portal ficaria vazio até o 1º intervalo (até 6h) — ruim no
 * go-live. A carga roda alguns segundos após subir (deixa a API atender health primeiro)
 * e só se ainda não houver nada sincronizado, para não repuxar tudo a cada redeploy.
 */
function iniciarAgendador() {
  if (!client.isConfigured()) return;
  const horas = Number(process.env.GCLICK_SYNC_INTERVAL_H || 0);
  const cargaInicial = process.env.GCLICK_SYNC_ON_BOOT !== "false";

  if (cargaInicial) {
    setTimeout(async () => {
      try {
        const { rows } = await db.query(
          "SELECT 1 FROM deliverables WHERE source = 'gclick' LIMIT 1"
        );
        if (rows.length) {
          console.log("[sync] já há documentos sincronizados; pulando carga inicial.");
          return;
        }
        console.log("[sync] carga inicial (portal vazio)...");
        // Sem `notificar: false` aqui, todo cliente com guia nos últimos meses levaria
        // um WhatsApp "documento novo" de uma vez só no primeiro boot — é histórico
        // para quem está vendo agora, não chegada de verdade.
        await sincronizar({ notificar: false });
      } catch (err) {
        console.error("[sync] carga inicial falhou:", err.message);
      }
    }, 8000).unref();
  }

  if (horas > 0) {
    const ms = horas * 3600 * 1000;
    setInterval(() => {
      sincronizar().catch((err) => console.error("[sync] ciclo periódico:", err.message));
    }, ms).unref();
    console.log(`[sync] agendador ligado: a cada ${horas}h`);
  }
}

module.exports = { sincronizar, iniciarAgendador, estaRodando, ultimaExecucao };
