/**
 * Unificação do funcionário que o CLIENTE cadastrou com o que o ESCRITÓRIO registra.
 *
 * O cliente cadastra livremente (ex.: entrou no dia 01 e ele já precisa emitir uma
 * advertência), mas o portal só recebe a folha no próximo fechamento. Quando a folha
 * chega, a mesma pessoa viria de novo — às vezes com o nome escrito diferente ou com um
 * dígito do CPF trocado — e ficaria duplicada.
 *
 * Um cadastro é **provisório** enquanto não apareceu na folha (sem `codigo`) e veio do
 * cliente ou de uma listagem sem CPF. Regras:
 *
 *  - **Automático** (`unificarAutomatico`): provisório com o MESMO CPF ou o MESMO nome
 *    (sem acento/caixa) de um cadastro oficial é absorvido por ele. Só quando há um
 *    único candidato — dois iguais é caso para gente olhar.
 *  - **Manual** (`sugestoesManuais` + `unificar`): o resto (nome parecido, CPF com
 *    dígito trocado) vira sugestão para o admin confirmar.
 *
 * Unificar mantém o cadastro oficial e move para ele tudo que apontava para o
 * provisório (atestados, avisos…), descobrindo as tabelas pelas FKs — tabela nova que
 * referencie `employees` entra sem mexer aqui.
 */

const PARTICULAS = new Set(["DE", "DA", "DO", "DAS", "DOS", "E"]);

function soDigitos(v) {
  return String(v || "").replace(/\D/g, "");
}

/** "Sílvana  Elizabeth da Costa " → "SILVANA ELIZABETH DA COSTA" */
function normalizarNome(nome) {
  return String(nome || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]+/g, " ")
    .trim();
}

function tokensNome(nome) {
  return normalizarNome(nome)
    .split(" ")
    .filter((t) => t && !PARTICULAS.has(t));
}

function ehProvisorio(e) {
  if (e.codigo) return false;
  return e.origem === "cliente" || soDigitos(e.cpf).length !== 11;
}

/** Oficial = já veio da folha, ou o escritório cadastrou com CPF. */
function ehOficial(e) {
  return !ehProvisorio(e);
}

/** Quantos dígitos diferem entre dois CPFs de 11 dígitos (Infinity se não comparáveis). */
function digitosDiferentes(a, b) {
  const x = soDigitos(a);
  const y = soDigitos(b);
  if (x.length !== 11 || y.length !== 11) return Infinity;
  let n = 0;
  for (let i = 0; i < 11; i += 1) if (x[i] !== y[i]) n += 1;
  return n;
}

/**
 * 0..1 — quão provável é ser a mesma pessoa. CPF igual e nome igual são certeza;
 * o resto é palpite para o admin conferir.
 */
function semelhanca(a, b) {
  const ca = soDigitos(a.cpf);
  if (ca.length === 11 && ca === soDigitos(b.cpf)) return 1;
  if (normalizarNome(a.name) && normalizarNome(a.name) === normalizarNome(b.name)) return 0.95;

  const ta = tokensNome(a.name);
  const tb = tokensNome(b.name);
  if (!ta.length || !tb.length) return 0;
  const mesmoPrimeiro = ta[0] === tb[0];
  // CPF com um ou dois dígitos trocados + mesmo primeiro nome: erro de digitação.
  if (mesmoPrimeiro && digitosDiferentes(a.cpf, b.cpf) <= 2) return 0.9;

  const sa = new Set(ta);
  const sb = new Set(tb);
  const inter = [...sa].filter((t) => sb.has(t)).length;
  const jaccard = inter / new Set([...sa, ...sb]).size;
  if (mesmoPrimeiro && ta[ta.length - 1] === tb[tb.length - 1]) return Math.max(0.8, jaccard);
  // "MARIA SOUZA" x "MARIA APARECIDA SOUZA": todos os nomes de um estão no outro.
  if (mesmoPrimeiro && inter === Math.min(sa.size, sb.size) && inter >= 2) return 0.75;
  return mesmoPrimeiro ? jaccard * 0.8 : jaccard * 0.5;
}

/**
 * Pares (provisório → oficial) seguros para unir sem ninguém olhar: CPF igual, ou nome
 * idêntico. Exige candidato único dos dois lados.
 */
function paresAutomaticos(funcionarios) {
  const oficiais = funcionarios.filter(ehOficial);
  const provisorios = funcionarios.filter(ehProvisorio);
  const pares = [];
  const usados = new Set();
  for (const p of provisorios) {
    const cpf = soDigitos(p.cpf);
    let cands = cpf.length === 11 ? oficiais.filter((o) => soDigitos(o.cpf) === cpf) : [];
    if (!cands.length) {
      const nome = normalizarNome(p.name);
      // Nome igual mas CPFs válidos bem diferentes pode ser homônimo: fica para o manual.
      if (nome) {
        cands = oficiais.filter(
          (o) => normalizarNome(o.name) === nome && (cpf.length !== 11 || digitosDiferentes(cpf, o.cpf) <= 2)
        );
      }
    }
    if (cands.length !== 1 || usados.has(cands[0].id)) continue;
    // Outro provisório disputando o mesmo oficial? Então não é óbvio — vai para o manual.
    const rivais = provisorios.filter(
      (q) =>
        q.id !== p.id &&
        ((cpf.length === 11 && soDigitos(q.cpf) === cpf) || normalizarNome(q.name) === normalizarNome(p.name))
    );
    if (rivais.length) continue;
    usados.add(cands[0].id);
    pares.push({ manter: cands[0], absorver: p });
  }
  return pares;
}

const LIMIAR_SUGESTAO = 0.6;

/**
 * Provisórios ativos ainda não conferidos, cada um com o melhor candidato a ser a mesma
 * pessoa (ou null: provavelmente é admissão nova que a folha ainda não trouxe).
 */
function sugestoesManuais(funcionarios) {
  return funcionarios
    .filter((p) => ehProvisorio(p) && p.active !== false && !p.conferido_em)
    .map((p) => {
      let melhor = null;
      let nota = 0;
      for (const o of funcionarios) {
        if (o.id === p.id) continue;
        const s = semelhanca(p, o) + (ehOficial(o) ? 0.001 : 0);
        if (s > nota) {
          nota = s;
          melhor = o;
        }
      }
      return {
        provisorio: p,
        sugestao: nota >= LIMIAR_SUGESTAO ? melhor : null,
        semelhanca: nota >= LIMIAR_SUGESTAO ? Math.round(Math.min(nota, 1) * 100) : 0,
      };
    });
}

/** Tabelas/colunas que apontam para employees(id). */
async function referenciasAoFuncionario(client) {
  const { rows } = await client.query(
    `SELECT c.conrelid::regclass::text AS tabela, a.attname AS coluna
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = 'employees'::regclass`
  );
  return rows;
}

/**
 * Une `absorverId` em `manterId` (mesma empresa). O oficial manda nos dados; do
 * provisório só aproveita o que faltava (PIS, CPF quando o oficial veio sem).
 * Deve rodar dentro de uma transação aberta por quem chama.
 */
async function unificar(client, companyId, manterId, absorverId) {
  if (manterId === absorverId) throw new Error("Escolha dois cadastros diferentes");
  const { rows } = await client.query(
    "SELECT id, cpf, pis, active FROM employees WHERE company_id = $1 AND id = ANY($2::uuid[])",
    [companyId, [manterId, absorverId]]
  );
  const manter = rows.find((r) => r.id === manterId);
  const absorver = rows.find((r) => r.id === absorverId);
  if (!manter || !absorver) throw new Error("Funcionário não encontrado nesta empresa");

  // Aviso de saída aberto é único por funcionário: o do provisório não pode colidir.
  await client.query(
    "DELETE FROM employee_exit_alerts WHERE employee_id = $1 AND situacao = 'pendente'",
    [absorverId]
  );

  for (const ref of await referenciasAoFuncionario(client)) {
    // Nomes vêm do catálogo do Postgres (regclass já sai entre aspas quando precisa).
    await client.query(
      `UPDATE ${ref.tabela} SET "${ref.coluna.replace(/"/g, '""')}" = $1 WHERE "${ref.coluna.replace(/"/g, '""')}" = $2`,
      [manterId, absorverId]
    );
  }

  const cpfManter = soDigitos(manter.cpf);
  await client.query(
    `UPDATE employees
        SET pis = COALESCE(NULLIF(pis, ''), $2),
            cpf = CASE WHEN length($3) = 11 THEN cpf ELSE COALESCE(NULLIF($4, ''), cpf) END,
            active = active OR $5,
            conferido_em = COALESCE(conferido_em, now())
      WHERE id = $1`,
    [manterId, absorver.pis || null, cpfManter, soDigitos(absorver.cpf), absorver.active === true]
  );
  await client.query("DELETE FROM employees WHERE id = $1", [absorverId]);
}

async function carregarFuncionarios(client, companyId) {
  const { rows } = await client.query(
    `SELECT id, name, cpf, pis, codigo, origem, active, conferido_em, created_at
       FROM employees WHERE company_id = $1 ORDER BY name`,
    [companyId]
  );
  return rows;
}

/** Une sozinho os pares óbvios. Devolve quantos foram unificados. */
async function unificarAutomatico(client, companyId) {
  const pares = paresAutomaticos(await carregarFuncionarios(client, companyId));
  for (const { manter, absorver } of pares) {
    await unificar(client, companyId, manter.id, absorver.id);
  }
  return pares.length;
}

module.exports = {
  normalizarNome,
  ehProvisorio,
  semelhanca,
  paresAutomaticos,
  sugestoesManuais,
  unificar,
  unificarAutomatico,
  carregarFuncionarios,
};
