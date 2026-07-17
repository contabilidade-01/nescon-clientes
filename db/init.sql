-- Schema initialization for self-hosted PostgreSQL
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  cnpj TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  contact_email TEXT,
  phone TEXT,
  tool_access JSONB DEFAULT '{"fiscal_guides":true,"payroll_files":true,"documents":true,"calendar":true,"suspension":true,"warning":true,"chatbot":true,"salary_adhoc":true,"employees":true,"certificates":true,"history":true}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Administrador global (login = CPF só dígitos; senha definida no seed)
CREATE TABLE IF NOT EXISTS platform_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cpf TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cpf TEXT NOT NULL,
  pis TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS issued_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type TEXT NOT NULL CHECK (document_type IN ('suspension', 'warning')),
  employee_name TEXT NOT NULL,
  employee_cpf TEXT NOT NULL,
  employee_pis TEXT,
  company_name TEXT NOT NULL,
  company_cnpj TEXT NOT NULL,
  company_id UUID REFERENCES companies(id),
  start_date DATE,
  suspension_days INTEGER,
  return_date DATE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS medical_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  certificate_date DATE DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Entregas da contabilidade ao cliente: guias fiscais e folha (origem 'gclick') e
-- documentos avulsos enviados pelo escritório (origem 'manual').
CREATE TABLE IF NOT EXISTS deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  doc_type TEXT,
  title TEXT NOT NULL,
  competencia TEXT,
  due_date DATE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'manual',
  external_ref TEXT,
  access_token TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deliverables_company_due ON deliverables(company_id, due_date);
CREATE INDEX IF NOT EXISTS idx_deliverables_token ON deliverables(access_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deliverables_company_external_ref
  ON deliverables(company_id, external_ref) WHERE external_ref IS NOT NULL;

-- Admin: login = CPF (abaixo); senha inicial nas anotações locais de acessos — trocar após o primeiro login.
INSERT INTO platform_admins (cpf, password_hash) VALUES (
  '05487541523',
  '$2a$10$P0E31oAGRjfkNOUZrd5.K..Wch43XC1WcK3HLiSYOQVK6DBlUbSaW'
) ON CONFLICT (cpf) DO NOTHING;

-- Seeds (login: CNPJ com/sem máscara; senha = CNPJ só dígitos).
INSERT INTO companies (name, cnpj, password_hash) VALUES (
  'RESTAURANTE DO QUEIJEIRO 3 LIMITADA',
  '52191264000173',
  '$2a$10$5faaPl2KUgL2HkTo0a2FPOOdHG7wBjhiVE8z.XaJA9SF8HvYUAjJq'
) ON CONFLICT (cnpj) DO NOTHING;

INSERT INTO companies (name, cnpj, password_hash) VALUES (
  'RESTAURANTE DO QUEIJEIRO 4 LTDA',
  '54803962000108',
  '$2a$10$LMyi3tOwE.FOi0nn8Q1Qz.NNN40Su8LSWVuBgu7AlQipQ7MoaVviG'
) ON CONFLICT (cnpj) DO NOTHING;

-- Empresa operacional (senha inicial segue a regra do README)
INSERT INTO companies (name, cnpj, password_hash) VALUES (
  'Gestão Empresa',
  '35736034000123',
  '$2a$10$4IXJRYObvEzVNQutX51uq.uuQBbijm.k1zfVnLNY2hSSL8aDjPH4a'
) ON CONFLICT (cnpj) DO NOTHING;
