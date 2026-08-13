/**
 * Áreas do painel — espelho de `api/src/adminAreas.js`. Ao acrescentar uma área,
 * mexer nos dois arquivos (e no menu, em AdminLayout).
 *
 * Esconder o item no menu é conforto; quem realmente barra o acesso é o servidor
 * (middleware/adminArea.js).
 */
export const ADMIN_AREAS = [
  "empresas",
  "funcionarios",
  "entregas",
  "licencas",
  "taxas_anuais",
  "lgpd",
  "sincronizacao",
  "envio_guias",
  "alertas",
  "atendimento",
  "acessos",
] as const;

export type AdminArea = (typeof ADMIN_AREAS)[number];
export type AdminAreaAccess = Record<AdminArea, boolean>;

export const ADMIN_AREA_LABELS: Record<AdminArea, { title: string; description: string }> = {
  empresas: { title: "Empresas", description: "Cadastro, contactos e permissões dos clientes" },
  funcionarios: { title: "Funcionários", description: "Quadro de pessoal e importações" },
  entregas: { title: "Documentos e entregas", description: "Guias, folha, atestados e envios" },
  licencas: { title: "Licenças", description: "Funcionamento, AVCB/CLCB e sanitária" },
  taxas_anuais: { title: "Taxas anuais", description: "Guias de taxa da prefeitura" },
  lgpd: { title: "Consentimentos LGPD", description: "Auditoria dos aceites dos clientes" },
  sincronizacao: { title: "Sincronização", description: "Carga de documentos do G-Click" },
  envio_guias: { title: "Envio de guias", description: "Sistema GCLICK (app separado)" },
  alertas: {
    title: "Alertas de vencimento",
    description: "Quais obrigações cada cliente recebe e o texto que sai",
  },
  atendimento: {
    title: "Atendimentos (chat)",
    description: "Conversas com os clientes pelo portal",
  },
  acessos: {
    title: "Controle de acessos",
    description: "Quem usa o portal, o que mais acessam e o que baixam",
  },
};

/** Chave ausente = sem acesso. `null`/`undefined` = acesso total (logins antigos). */
export function mergeAdminAreas(raw: unknown): AdminAreaAccess {
  if (raw === null || raw === undefined) {
    return Object.fromEntries(ADMIN_AREAS.map((a) => [a, true])) as AdminAreaAccess;
  }
  const o = (typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(ADMIN_AREAS.map((a) => [a, Boolean(o[a])])) as AdminAreaAccess;
}

/** O dono vê tudo, independentemente do que estiver marcado. */
export function canSeeArea(
  area: AdminArea,
  areas: AdminAreaAccess | undefined,
  isOwner?: boolean
): boolean {
  if (isOwner) return true;
  if (!areas) return false;
  return Boolean(areas[area]);
}
