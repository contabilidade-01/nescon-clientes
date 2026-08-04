/**
 * Usuários do painel: administrador deixa de ser tudo-ou-nada.
 *
 * `areas` nulo = acesso total (é o que os logins já existentes têm, e por isso a
 * migração não muda o comportamento de ninguém). `is_owner` é o dono: vê tudo e é o
 * único que cria/edita usuários.
 */
async function ensureAdminUsersSchema(db) {
  try {
    await db.query(`ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS nome TEXT;`);
    await db.query(`ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS areas JSONB;`);
    await db.query(
      `ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT false;`
    );
    await db.query(
      `ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;`
    );
    await db.query(
      `ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;`
    );
    await db.query(
      `ALTER TABLE platform_admins ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES platform_admins(id) ON DELETE SET NULL;`
    );

    // Sem nenhum dono, o sistema ficaria sem quem cria usuários. Na primeira execução
    // os administradores que já existem viram donos — hoje é só o CPF do seed.
    await db.query(`
      UPDATE platform_admins SET is_owner = true
       WHERE NOT EXISTS (SELECT 1 FROM platform_admins WHERE is_owner IS TRUE);
    `);

    console.log("[DB] platform_admins: areas/is_owner verificados.");
  } catch (err) {
    console.error("[DB] ensureAdminUsersSchema falhou:", err.message, err.code || "");
    throw err;
  }
}

module.exports = { ensureAdminUsersSchema };
