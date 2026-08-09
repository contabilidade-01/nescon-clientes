export const COMPANY_TOOL_KEYS = [
  // Portal do Cliente: entregas da contabilidade
  "fiscal_guides",
  "boletos",
  "payroll_files",
  "documents",
  "calendar",
  "vacations",
  // Departamento pessoal
  "suspension",
  "warning",
  "chatbot",
  "salary_adhoc",
  "employees",
  "certificates",
  "history",
] as const;

export type CompanyToolKey = (typeof COMPANY_TOOL_KEYS)[number];

export type CompanyToolAccess = Record<CompanyToolKey, boolean>;

/** Seções do menu do portal. A ordem define a ordem de exibição. */
export const TOOL_GROUPS = ["financeiro", "entregas", "dp"] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

export const TOOL_GROUP_LABELS: Record<ToolGroup, { title: string; description: string }> = {
  financeiro: { title: "Financeiro e vencimentos", description: "O que vence e quando pagar" },
  entregas: { title: "Documentos e entregas", description: "Contratos e relatórios" },
  dp: { title: "Departamento pessoal", description: "Folha, férias e rotinas de funcionários" },
};

export const COMPANY_TOOL_LABELS: Record<
  CompanyToolKey,
  { title: string; description: string; group: ToolGroup }
> = {
  calendar: {
    title: "Calendário de vencimentos",
    description: "Agenda com o que precisa ser pago",
    group: "financeiro",
  },
  fiscal_guides: {
    title: "Guias fiscais",
    description: "INSS, FGTS, Simples Nacional e demais tributos",
    group: "financeiro",
  },
  boletos: {
    title: "Boletos",
    description: "Boletos a pagar",
    group: "financeiro",
  },
  payroll_files: {
    title: "Folha de pagamento",
    description: "Holerites e relatórios da folha",
    group: "dp",
  },
  documents: {
    title: "Documentos",
    description: "Outros arquivos enviados pelo escritório",
    group: "entregas",
  },
  certificates: {
    title: "Atestados",
    description: "Gestão de atestados médicos",
    group: "entregas",
  },
  suspension: { title: "Suspensão", description: "Gerar termo de suspensão", group: "dp" },
  warning: { title: "Advertência", description: "Gerar termo de advertência", group: "dp" },
  chatbot: { title: "Assistente", description: "Gerar documentos via chatbot", group: "dp" },
  salary_adhoc: {
    title: "Salário avulso",
    description: "Cálculo proporcional (experiência / treino)",
    group: "dp",
  },
  employees: { title: "Funcionários", description: "Cadastro de funcionários", group: "dp" },
  vacations: {
    title: "Férias",
    description: "Quem tem direito, quanto custa e o limite de faltas",
    group: "dp",
  },
  history: { title: "Histórico", description: "Documentos emitidos", group: "dp" },
};

export function defaultToolAccess(): CompanyToolAccess {
  return COMPANY_TOOL_KEYS.reduce((acc, key) => {
    acc[key] = true;
    return acc;
  }, {} as CompanyToolAccess);
}

export function mergeClientToolAccess(raw: unknown): CompanyToolAccess {
  const base = defaultToolAccess();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  for (const k of COMPANY_TOOL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(o, k)) {
      base[k] = Boolean(o[k]);
    }
  }
  return base;
}

export function isToolAllowed(access: CompanyToolAccess | undefined, key: CompanyToolKey): boolean {
  if (!access) return true;
  return Boolean(access[key]);
}
