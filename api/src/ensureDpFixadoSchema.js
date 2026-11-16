/**
 * Marca de quando o portal ligou sozinho advertência e suspensão para a empresa que
 * passou a ter funcionário (ver dpFixado.js). Liga uma vez só: se o escritório
 * desligar depois, a marca impede que a rotina religue.
 */
async function ensureDpFixadoSchema(db) {
  await db.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS dp_auto_ligado_em TIMESTAMPTZ;`);
}

module.exports = { ensureDpFixadoSchema };
