/**
 * Espelho das pendências do e-CAC: traz do central-ecac e guarda por empresa.
 *
 * A JUNÇÃO é pelo CNPJ com 14 dígitos, dos dois lados. O que não casa vira lista
 * "sem cadastro" para o escritório, nunca cobrança. Empresa arquivada/excluída aqui não
 * entra mesmo que siga ativa lá. Cliente pessoa física (CPF) não existe no e-CAC.
 *
 * Nada aqui envia mensagem nem decide estado — isso é `ecacCobranca.js`.
 */
const ecac = require("./ecacClient");
const { espelhoDaEmpresa, cnpjChave } = require("./ecacRegras");

/** Empresas ativas do portal, por CNPJ (14 dígitos). */
async function mapaEmpresasPorCnpj(db) {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.cnpj, c.contact_email, c.alertas_ativos, c.ecac_cobranca_ativa
       FROM companies c
      WHERE COALESCE(c.arquivada, false) = false
        AND COALESCE(c.excluida, false) = false`
  );
  const mapa = new Map();
  for (const r of rows) {
    const chave = cnpjChave(r.cnpj);
    if (chave) mapa.set(chave, r);
  }
  return mapa;
}

/** Grava/atualiza a linha do espelho. Devolve { id, novo }. */
async function upsertEspelho(db, companyId, esp) {
  const { rows } = await db.query(
    `INSERT INTO ecac_pendencias
       (company_id, cnpj, relatorio_id, relatorio_data, debitos, omissoes, parcelamento, pgfn,
        qtd_atraso, total_atraso, qtd_a_vencer, qtd_invalidos)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (company_id, relatorio_id) DO UPDATE
       SET debitos = EXCLUDED.debitos, omissoes = EXCLUDED.omissoes,
           parcelamento = EXCLUDED.parcelamento, pgfn = EXCLUDED.pgfn,
           qtd_atraso = EXCLUDED.qtd_atraso, total_atraso = EXCLUDED.total_atraso,
           qtd_a_vencer = EXCLUDED.qtd_a_vencer, qtd_invalidos = EXCLUDED.qtd_invalidos,
           importado_em = now()
     RETURNING id, (xmax = 0) AS novo`,
    [
      companyId, esp.cnpj, esp.relatorio_id, esp.relatorio_data,
      JSON.stringify(esp.debitos), JSON.stringify(esp.omissoes), esp.parcelamento, esp.pgfn,
      esp.qtd_atraso, esp.total_atraso, esp.qtd_a_vencer, esp.qtd_invalidos,
    ]
  );
  return { id: rows[0].id, novo: Boolean(rows[0].novo) };
}

/** Linha mais recente do espelho de uma empresa (ou null). */
async function ultimaPendencia(db, companyId) {
  const { rows } = await db.query(
    `SELECT * FROM ecac_pendencias WHERE company_id = $1 ORDER BY relatorio_id DESC LIMIT 1`,
    [companyId]
  );
  return rows[0] || null;
}

/**
 * Importa a carteira inteira. `desde` ('AAAA-MM-DD') define o que é relatório "do ciclo".
 * Devolve o resumo que o painel mostra: quem casou, quem não tem cadastro aqui, quem
 * ficou com relatório velho (pulado no lote de lá) e quem tem atraso.
 */
async function importarCarteira(db, { desde }) {
  const empresasEcac = await ecac.pendencias({ desde });
  const mapa = await mapaEmpresasPorCnpj(db);

  const resumo = {
    desde,
    total_ecac: empresasEcac.length,
    casadas: 0,
    novas: 0,
    com_atraso: 0,
    sem_cadastro: [],
    sem_relatorio: [],
    relatorios_velhos: [],
    inativas_no_ecac: [],
    erros: [],
    empresas: [],
  };

  for (const e of empresasEcac) {
    const chave = cnpjChave(e.cnpj);
    if (!chave) continue;
    const empresa = mapa.get(chave);
    if (!empresa) {
      resumo.sem_cadastro.push({ cnpj: chave, razao_social: e.razao_social || null });
      continue;
    }
    if (e.ativo === false) {
      resumo.inativas_no_ecac.push({ cnpj: chave, name: empresa.name });
      continue;
    }
    const esp = espelhoDaEmpresa(e);
    if (!esp) {
      resumo.sem_relatorio.push({ cnpj: chave, name: empresa.name });
      continue;
    }
    try {
      const { id, novo } = await upsertEspelho(db, empresa.id, esp);
      resumo.casadas += 1;
      if (novo) resumo.novas += 1;
      if (!esp.relatorio_recente) resumo.relatorios_velhos.push({ cnpj: chave, name: empresa.name, relatorio_data: esp.relatorio_data });
      if (esp.qtd_atraso > 0) resumo.com_atraso += 1;
      resumo.empresas.push({ companyId: empresa.id, name: empresa.name, cnpj: chave, pendenciaId: id, novo, espelho: esp, empresa });
    } catch (err) {
      resumo.erros.push({ cnpj: chave, erro: err.message });
    }
  }
  return resumo;
}

/** Importa UMA empresa (custo zero lá). Devolve { pendenciaId, novo, espelho } ou null. */
async function importarEmpresa(db, companyId, cnpj, { desde = null } = {}) {
  const e = await ecac.pendenciasEmpresa(cnpj, { desde });
  const esp = espelhoDaEmpresa(e);
  if (!esp) return null;
  const { id, novo } = await upsertEspelho(db, companyId, esp);
  return { pendenciaId: id, novo, espelho: esp };
}

module.exports = { mapaEmpresasPorCnpj, upsertEspelho, ultimaPendencia, importarCarteira, importarEmpresa };
