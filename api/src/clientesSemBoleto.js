/**
 * Conferência mensal: quais clientes ativos ficaram sem boleto de honorário na competência.
 *
 * O caminho normal é emitir o boleto na Cora e a sync trazer para `deliverables`. Se o
 * escritório esquece de emitir para alguém, nada no sistema reclama: não há boleto, logo
 * não há cobrança, alerta nem tela. Esta conferência faz a conta ao contrário — parte do
 * cadastro de empresas ativas e aponta quem não tem nenhum boleto Cora no mês.
 *
 * "Boleto do mês" = boleto Cora não cancelado cuja competência (derivada do VENCIMENTO,
 * ver coraSync.competenciaDe) é a escolhida. Só leitura: não cria nem altera nada.
 */

/** "2026-10" válido? Função pura. */
function competenciaValida(c) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(c || ""));
}

/** Competência (YYYY-MM) de uma data no fuso de São Paulo. Função pura. */
function competenciaAtual(agora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(agora);
  const ano = partes.find((p) => p.type === "year").value;
  const mes = partes.find((p) => p.type === "month").value;
  return `${ano}-${mes}`;
}

/**
 * Função pura: separa as empresas ativas em sem boleto / cobertas pela matriz / com boleto.
 *
 * Filial sem boleto próprio cuja matriz teve boleto no mês fica em `cobertas_pela_matriz`:
 * é comum o honorário do grupo sair num boleto só, no CNPJ da matriz. Fica visível à
 * parte, e não somada às faltas, para a lista principal mostrar só o que é provável erro.
 *
 * @param empresas  [{ id, name, cnpj, matriz_id, boletos, boletos_ativo, gclick_status,
 *                    honorario_cobranca_ativo }] — `boletos` = qtd. na competência
 */
function classificarClientes(empresas) {
  const boletosPorId = new Map(empresas.map((e) => [e.id, Number(e.boletos) || 0]));
  const nomePorId = new Map(empresas.map((e) => [e.id, e.name]));

  const sem_boleto = [];
  const cobertas_pela_matriz = [];
  let com_boleto = 0;

  for (const e of empresas) {
    if ((Number(e.boletos) || 0) > 0) {
      com_boleto++;
      continue;
    }
    const item = {
      id: e.id,
      name: e.name,
      cnpj: e.cnpj,
      matriz_id: e.matriz_id || null,
      matriz_nome: e.matriz_id ? nomePorId.get(e.matriz_id) || null : null,
      boletos_ativo: e.boletos_ativo !== false,
      honorario_cobranca_ativo: e.honorario_cobranca_ativo !== false,
      gclick_status: e.gclick_status || null,
    };
    if (e.matriz_id && (boletosPorId.get(e.matriz_id) || 0) > 0) cobertas_pela_matriz.push(item);
    else sem_boleto.push(item);
  }

  const porNome = (a, b) => String(a.name).localeCompare(String(b.name), "pt-BR");
  return {
    total_ativas: empresas.length,
    com_boleto,
    sem_boleto: sem_boleto.sort(porNome),
    cobertas_pela_matriz: cobertas_pela_matriz.sort(porNome),
  };
}

/** Lê do banco e classifica. Empresa ativa = não arquivada e não excluída. */
async function conferirClientesSemBoleto(db, competencia) {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.cnpj, c.matriz_id, c.gclick_status,
            c.honorario_cobranca_ativo,
            (c.tool_access IS NULL OR c.tool_access->>'boletos' = 'true') AS boletos_ativo,
            COUNT(d.id)::int AS boletos
       FROM companies c
       LEFT JOIN deliverables d
              ON d.company_id = c.id
             AND d.source = 'cora'
             AND d.cancelado IS NOT TRUE
             AND d.competencia = $1
      WHERE c.arquivada IS NOT TRUE
        AND c.excluida IS NOT TRUE
      GROUP BY c.id`,
    [competencia]
  );
  return { competencia, ...classificarClientes(rows) };
}

module.exports = { competenciaValida, competenciaAtual, classificarClientes, conferirClientesSemBoleto };
