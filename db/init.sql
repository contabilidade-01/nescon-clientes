-- Schema initialization for self-hosted PostgreSQL
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  cnpj TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  contact_email TEXT,
  phone TEXT,
  tool_access JSONB DEFAULT '{"fiscal_guides":true,"boletos":true,"payroll_files":true,"documents":true,"calendar":true,"suspension":true,"warning":true,"chatbot":true,"salary_adhoc":true,"employees":true,"certificates":true,"history":true}'::jsonb,
  -- Estabelecida = tem ponto físico e por isso precisa de licenças. Não estabelecida
  -- fica fora do painel de licenças.
  established BOOLEAN NOT NULL DEFAULT true,
  -- LGPD: carimbo do aceite (nulo = ainda não concordou) e de quando o aviso foi exibido.
  lgpd_consent_at TIMESTAMPTZ,
  lgpd_consent_ip TEXT,
  lgpd_consent_version TEXT,
  lgpd_prompt_seen_at TIMESTAMPTZ,
  -- Informativo: situação no G-Click (ATIVO/DESATIVADO). Não bloqueia nada.
  gclick_status TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Administrador global (login = CPF só dígitos; senha definida no seed)
CREATE TABLE IF NOT EXISTS platform_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cpf TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nome TEXT,
  -- Áreas do painel liberadas. NULO = acesso total (compatível com logins antigos).
  areas JSONB,
  -- Dono: vê tudo e é o único que gerencia usuários.
  is_owner BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
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

-- Licenças do cliente. Só guardamos a data de vencimento: "ativa/a vencer/vencida" é
-- calculado na leitura (api/src/licenseStatus.js). Renovar = inserir nova linha.
CREATE TABLE IF NOT EXISTS company_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('funcionamento', 'avcb_clcb', 'sanitaria')),
  numero TEXT,
  orgao TEXT,
  emitida_em DATE,
  vence_em DATE NOT NULL,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_licenses_vigente
  ON company_licenses(company_id, tipo, vence_em DESC);

-- Guia da taxa anual da prefeitura: uma linha por empresa e ano.
CREATE TABLE IF NOT EXISTS annual_tax_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ano INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviado', 'confirmado')),
  enviado_em TIMESTAMPTZ,
  confirmado_em TIMESTAMPTZ,
  observacao TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, ano)
);

CREATE INDEX IF NOT EXISTS idx_annual_tax_receipts_ano ON annual_tax_receipts(ano, status);

-- Espelho dos clientes do G-Click + decisão do escritório. O G-Click escreve aqui,
-- nunca em companies: a empresa só nasce quando o admin aceita.
CREATE TABLE IF NOT EXISTS gclick_clients (
  cnpj TEXT PRIMARY KEY,
  nome TEXT,
  email TEXT,
  phone TEXT,
  status_gclick TEXT,
  decisao TEXT NOT NULL DEFAULT 'pendente' CHECK (decisao IN ('pendente', 'aceito', 'rejeitado')),
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  decidido_em TIMESTAMPTZ,
  motivo_rejeicao TEXT,
  primeiro_visto_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gclick_clients_decisao ON gclick_clients(decisao, status_gclick);

-- Caixa de alertas: cliente novo (decisão) e mudança de status (ciência).
CREATE TABLE IF NOT EXISTS gclick_pendencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('novo_cliente', 'status_alterado')),
  dados JSONB NOT NULL DEFAULT '{}',
  situacao TEXT NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'resolvido')),
  resolucao TEXT CHECK (resolucao IN ('cadastrado', 'rejeitado', 'ciente')),
  resolvido_em TIMESTAMPTZ,
  resolvido_por UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uma pendência aberta por CNPJ e tipo: sincronizar de novo não duplica alerta.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gclick_pendencias_abertas
  ON gclick_pendencias(cnpj, tipo) WHERE situacao = 'pendente';

-- Opções que o escritório muda pela tela, sem redeploy (variável de ambiente é o padrão).
CREATE TABLE IF NOT EXISTS app_settings (
  chave TEXT PRIMARY KEY,
  valor TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin: login = CPF (abaixo); senha inicial nas anotações locais de acessos — trocar após o primeiro login.
INSERT INTO platform_admins (cpf, password_hash, is_owner) VALUES (
  '05487541523',
  '$2a$10$P0E31oAGRjfkNOUZrd5.K..Wch43XC1WcK3HLiSYOQVK6DBlUbSaW',
  true
) ON CONFLICT (cpf) DO NOTHING;

-- Empresa operacional da contabilidade (login: CNPJ com/sem máscara; senha = CNPJ só dígitos).
-- As demais empresas (clientes) são criadas automaticamente pela sincronização com o G-Click.
INSERT INTO companies (name, cnpj, password_hash) VALUES (
  'NESCON CONSULTORIA',
  '35736034000123',
  '$2a$10$4IXJRYObvEzVNQutX51uq.uuQBbijm.k1zfVnLNY2hSSL8aDjPH4a'
) ON CONFLICT (cnpj) DO NOTHING;
