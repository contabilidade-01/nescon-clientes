/**
 * Painel "Atualização de Honorários": catálogo de padrões de mensalidade +
 * perfil/valores por empresa. Tolerâncias (tol_abaixo / tol_acima) ficam em
 * app_settings (ver honorariosAtualizacao.js).
 *
 * Seed: combinações enquadramento × tipo × complexidade com valores alinhados
 * à tabela comercial Nescon (baixa 350 / média 500 / alta 1.200). INSERT só
 * quando a tabela está vazia — o escritório edita depois sem perder ajustes.
 */
async function ensureHonorarioAtualizacaoSchema(db) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS honorario_padroes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        label TEXT NOT NULL,
        enquadramento TEXT NOT NULL
          CHECK (enquadramento IN ('mei', 'simples', 'presumido', 'real')),
        tipo_empresa TEXT NOT NULL
          CHECK (tipo_empresa IN ('servico', 'comercio', 'industria')),
        complexidade TEXT NOT NULL
          CHECK (complexidade IN ('baixa', 'media', 'alta')),
        valor_a_partir_centavos INTEGER NOT NULL CHECK (valor_a_partir_centavos >= 0),
        ativo BOOLEAN NOT NULL DEFAULT true,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (enquadramento, tipo_empresa, complexidade)
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS honorario_atualizacao (
        company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
        enquadramento TEXT
          CHECK (enquadramento IS NULL OR enquadramento IN ('mei', 'simples', 'presumido', 'real')),
        tipo_empresa TEXT
          CHECK (tipo_empresa IS NULL OR tipo_empresa IN ('servico', 'comercio', 'industria')),
        complexidade TEXT
          CHECK (complexidade IS NULL OR complexidade IN ('baixa', 'media', 'alta')),
        padrao_id UUID REFERENCES honorario_padroes(id) ON DELETE SET NULL,
        atual_centavos INTEGER CHECK (atual_centavos IS NULL OR atual_centavos >= 0),
        atual_origem TEXT CHECK (atual_origem IS NULL OR atual_origem IN ('cora', 'manual')),
        ideal_sugerido_centavos INTEGER CHECK (ideal_sugerido_centavos IS NULL OR ideal_sugerido_centavos >= 0),
        ideal_centavos INTEGER CHECK (ideal_centavos IS NULL OR ideal_centavos >= 0),
        ok_manual BOOLEAN,
        oculto BOOLEAN NOT NULL DEFAULT false,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
        atualizado_por UUID
      );
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_honorario_atualizacao_oculto
        ON honorario_atualizacao (oculto);
    `);

    const { rows: contagem } = await db.query("SELECT COUNT(*)::int AS n FROM honorario_padroes");
    if (contagem[0].n === 0) {
      const ENQ = ["mei", "simples", "presumido", "real"];
      const TIPOS = ["servico", "comercio", "industria"];
      const COMPLEX = [
        { c: "baixa", v: 35000 },
        { c: "media", v: 50000 },
        { c: "alta", v: 120000 },
      ];
      const LABELS = {
        mei: "MEI",
        simples: "Simples",
        presumido: "Presumido",
        real: "Real",
        servico: "Serviço",
        comercio: "Comércio",
        industria: "Indústria",
        baixa: "baixa",
        media: "média",
        alta: "alta",
      };
      const values = [];
      const params = [];
      let i = 1;
      for (const e of ENQ) {
        for (const t of TIPOS) {
          for (const { c, v } of COMPLEX) {
            const label = `${LABELS[e]} · ${LABELS[t]} · ${LABELS[c]}`;
            values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
            params.push(label, e, t, c, v);
          }
        }
      }
      await db.query(
        `INSERT INTO honorario_padroes
           (label, enquadramento, tipo_empresa, complexidade, valor_a_partir_centavos)
         VALUES ${values.join(", ")}`,
        params
      );
      console.log(`[DB] honorario_padroes: ${params.length / 5} padrões semeados.`);
    }

    console.log("[DB] honorario_atualizacao: tabelas verificadas.");
  } catch (err) {
    console.error("[DB] ensureHonorarioAtualizacaoSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureHonorarioAtualizacaoSchema };
