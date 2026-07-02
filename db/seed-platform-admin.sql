-- Bases já existentes: criar tabela + admin (senha inicial nas anotações locais de acessos)
CREATE TABLE IF NOT EXISTS platform_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cpf TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO platform_admins (cpf, password_hash) VALUES (
  '05487541523',
  '$2a$10$P0E31oAGRjfkNOUZrd5.K..Wch43XC1WcK3HLiSYOQVK6DBlUbSaW'
) ON CONFLICT (cpf) DO UPDATE SET password_hash = EXCLUDED.password_hash;
