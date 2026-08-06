/**
 * Histórico de folha por competência — a base do relatório gerencial.
 *
 * ## Por que aqui a regra da casa se inverte
 *
 * O resto do sistema calcula estado em vez de gravar (situação de licença, de férias).
 * Aquilo se deriva de dados que **já estão no banco**, e um valor gravado envelheceria.
 *
 * Aqui a origem é um PDF — externo, e **mutável de um jeito destrutivo**: quando o
 * G-Click retifica uma competência, `gravarGuia` apaga o arquivo anterior. Recalcular do
 * PDF faria uma retificação de março reescrever silenciosamente o histórico de março,
 * sem ninguém saber que o número mudou. Guardar o retrato, com o carimbo de qual entrega
 * o gerou e quando, é o que torna a mudança visível.
 *
 * Somam-se duas razões práticas: reparsear centenas de PDFs a cada filtro de data não
 * escala, e o volume de arquivos não tem backup enquanto o banco tem — persistir põe o
 * relatório debaixo da cópia diária.
 *
 * ## Uma linha por empresa × competência
 *
 * A chave única faz reimportação **atualizar**, não duplicar. Retificação corrige o mês
 * em vez de criar um segundo março fantasma que somaria em dobro no gráfico.
 */
async function ensurePayrollHistorySchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS payroll_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        competencia TEXT NOT NULL,
        -- De qual extrato veio. É o rastro que permite conferir o número no documento
        -- e saber que a linha foi refeita por uma retificação.
        deliverable_id UUID REFERENCES deliverables(id) ON DELETE SET NULL,

        -- Totais da folha
        proventos NUMERIC(14,2),
        descontos NUMERIC(14,2),
        liquido NUMERIC(14,2),
        inss NUMERIC(14,2),
        fgts NUMERIC(14,2),
        base_fgts NUMERIC(14,2),
        irrf NUMERIC(14,2),

        -- Movimentação de pessoal (rodapé "Situações"): a base do turnover
        empregados INTEGER,
        admitidos INTEGER,
        demitidos INTEGER,
        trabalhando INTEGER,
        em_ferias INTEGER,

        -- Custo de atestado dos primeiros 15 dias, que é o que a empresa paga
        afastamento_valor NUMERIC(14,2),
        afastamento_dias NUMERIC(8,2),
        afastamento_funcionarios INTEGER,

        -- Absenteísmo. DSR fica separado de propósito: é consequência da falta, não um
        -- dia a mais de ausência — somar os dois inflaria o indicador.
        faltas_dias NUMERIC(8,2),
        faltas_dias_dsr NUMERIC(8,2),

        -- Quando a leitura não fecha, o número não some: fica marcado para a tela avisar
        -- em vez de exibir uma linha errada com cara de certa.
        conferido BOOLEAN NOT NULL DEFAULT true,
        problemas TEXT,

        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_snapshots_unico
        ON payroll_snapshots(company_id, competencia);
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_payroll_snapshots_competencia
        ON payroll_snapshots(competencia);
    `);

    // Data de admissão: sai do próprio extrato e é o que dá os avos do 13º. Sem ela a
    // projeção assume ano inteiro — seguro para o caixa, mas impreciso para quem entrou
    // no meio do ano.
    await db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS admissao DATE;`);

    console.log("[DB] histórico de folha: tabela verificada/criada.");
  } catch (err) {
    console.error("[DB] ensurePayrollHistorySchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensurePayrollHistorySchema };
