/**
 * Compatibilidade com bases PostgreSQL antigas ainda sem a coluna companies.tool_access.
 * Código de erro: 42703 = undefined_column
 */
const { mergeToolAccess } = require("./companyTools");

const PG_UNDEFINED_COLUMN = "42703";

async function listCompanies(db) {
  try {
    const { rows } = await db.query(
      "SELECT id, name, cnpj, contact_email, phone, tool_access, gclick_status, created_at FROM companies ORDER BY name"
    );
    return rows;
  } catch (err) {
    if (err.code !== PG_UNDEFINED_COLUMN) throw err;
    const { rows } = await db.query(
      "SELECT id, name, cnpj, contact_email, phone, created_at FROM companies ORDER BY name"
    );
    return rows.map((r) => ({ ...r, tool_access: null, gclick_status: null }));
  }
}

async function getCompanyByCnpjForLogin(db, cnpjDigits) {
  try {
    const { rows } = await db.query(
      `SELECT id, name, cnpj, password_hash, tool_access, must_change_password, password_expires_at
       FROM companies WHERE cnpj = $1`,
      [cnpjDigits]
    );
    return rows;
  } catch (err) {
    if (err.code !== PG_UNDEFINED_COLUMN) throw err;
    const { rows } = await db.query(
      "SELECT id, name, cnpj, password_hash FROM companies WHERE cnpj = $1",
      [cnpjDigits]
    );
    return rows.map((r) => ({ ...r, tool_access: null, must_change_password: false, password_expires_at: null }));
  }
}

async function getToolAccessForCompany(db, companyId) {
  try {
    const { rows } = await db.query("SELECT tool_access FROM companies WHERE id = $1 LIMIT 1", [companyId]);
    return mergeToolAccess(rows[0]?.tool_access);
  } catch (err) {
    if (err.code !== PG_UNDEFINED_COLUMN) throw err;
    return mergeToolAccess(null);
  }
}

async function insertCompanyRow(db, { name, cnpjDigits, passwordHash, emailNorm, phoneNorm }) {
  try {
    // A senha inicial é o CNPJ (público) — nasce exigindo troca no primeiro acesso.
    const { rows } = await db.query(
      `INSERT INTO companies (name, cnpj, password_hash, contact_email, phone, must_change_password)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, name, cnpj, contact_email, phone, tool_access, created_at`,
      [name, cnpjDigits, passwordHash, emailNorm, phoneNorm]
    );
    return rows[0];
  } catch (err) {
    if (err.code !== PG_UNDEFINED_COLUMN) throw err;
    const { rows } = await db.query(
      `INSERT INTO companies (name, cnpj, password_hash, contact_email, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, cnpj, contact_email, phone, created_at`,
      [name, cnpjDigits, passwordHash, emailNorm, phoneNorm]
    );
    return { ...rows[0], tool_access: null };
  }
}

module.exports = {
  PG_UNDEFINED_COLUMN,
  listCompanies,
  getCompanyByCnpjForLogin,
  getToolAccessForCompany,
  insertCompanyRow,
};
