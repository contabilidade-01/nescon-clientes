-- Correr no Postgres se a BD já existir mas faltar a empresa NESCON CONSULTORIA (login = CNPJ abaixo; senha inicial = CNPJ só dígitos)
-- (o init.sql completo só corre na primeira criação do volume)
INSERT INTO companies (name, cnpj, password_hash) VALUES (
  'NESCON CONSULTORIA',
  '35736034000123',
  '$2a$10$4IXJRYObvEzVNQutX51uq.uuQBbijm.k1zfVnLNY2hSSL8aDjPH4a'
) ON CONFLICT (cnpj) DO NOTHING;

-- Se a empresa JÁ existir com o nome placeholder, corrige o nome (o INSERT acima não sobrescreve por causa do ON CONFLICT):
UPDATE companies SET name = 'NESCON CONSULTORIA'
 WHERE cnpj = '35736034000123' AND name = 'Gestão Empresa';
