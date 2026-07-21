import type { CompanyToolAccess } from "@/lib/companyTools";

const rawApiBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || "/api";
const API_BASE = rawApiBase.replace(/\/+$/, "") || "/api";

function normalizeResponseText(text: string): string {
  return text.replace(/^\uFEFF/, "").trimStart();
}

/** JSON válido nunca começa por '<' após trim; HTML/XML quase sempre sim. */
function isProbablyHtmlBody(text: string, contentType: string): boolean {
  if (/text\/html/i.test(contentType)) return true;
  const t = normalizeResponseText(text);
  return t.startsWith("<");
}

/**
 * Evita "Unexpected token '<'" quando o host devolve index.html (SPA) em vez da API.
 * Comum em produção só com front: sem VITE_API_URL o browser pede /api no mesmo domínio e recebe HTML.
 */
async function parseResponseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const ct = res.headers.get("content-type") || "";
  const hint = import.meta.env.VITE_API_URL
    ? " Confirme se VITE_API_URL está correto e se a API está acessível."
    : " Defina VITE_API_URL no build (URL público da API Node, terminando em /api, ex.: https://api.seudominio.com/api) ou use um proxy que encaminhe /api para o backend.";

  if (isProbablyHtmlBody(text, ct)) {
    throw new Error(`A API não respondeu em JSON (foi recebido HTML).${hint}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    const head = normalizeResponseText(text).slice(0, 120).toLowerCase();
    if (head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<")) {
      throw new Error(`A API não respondeu em JSON (foi recebido HTML).${hint}`);
    }
    const msg = e instanceof Error ? e.message : "";
    if (/unexpected token.*</i.test(msg) || /not valid json/i.test(msg)) {
      throw new Error(`Resposta não é JSON válido.${hint}`);
    }
    throw new Error(normalizeResponseText(text).slice(0, 200) || "Resposta inválida do servidor.");
  }
}

/** Rotas públicas (login, recuperação de senha): sem Bearer e sem redirecionar em 401 */
async function publicRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await parseResponseJson<unknown>(res);
  if (!res.ok) {
    const err = data as { error?: string };
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return data as T;
}

function getToken(): string | null {
  try {
    const session = localStorage.getItem("company_session");
    if (!session) return null;
    const parsed = JSON.parse(session);
    return parsed.token || null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await parseResponseJson<unknown>(res);

  if (res.status === 401) {
    // Token expired - clear session and redirect to login
    localStorage.removeItem("company_session");
    window.location.href = "/login";
    throw new Error("Sessão expirada");
  }

  if (!res.ok) {
    const err = data as { error?: string };
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return data as T;
}

/** Busca binária autenticada: `<a href>` não envia o Bearer, então o arquivo vem por fetch. */
async function requestBlob(path: string): Promise<Blob> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (res.status === 401) {
    localStorage.removeItem("company_session");
    window.location.href = "/login";
    throw new Error("Sessão expirada");
  }
  if (!res.ok) {
    throw new Error(res.status === 404 ? "Documento não encontrado" : `HTTP ${res.status}`);
  }
  return res.blob();
}

export type DeliverableCategory = "guia" | "boleto" | "folha" | "outro";
export type DeliverableStatus = "pending" | "paid";

export type Deliverable = {
  id: string;
  company_id: string;
  category: DeliverableCategory;
  doc_type: string | null;
  title: string;
  competencia: string | null;
  due_date: string | null;
  file_name: string;
  status: DeliverableStatus;
  paid_at: string | null;
  source: "gclick" | "manual";
  created_at: string;
};

export type PublicDeliverable = {
  category: DeliverableCategory;
  doc_type: string | null;
  title: string;
  competencia: string | null;
  due_date: string | null;
  status: DeliverableStatus;
  file_name: string;
  company_name: string;
};

/** Mesma forma das permissões do cliente — fonte única em companyTools, evita as duas listas divergirem. */
export type CompanyToolAccessApi = CompanyToolAccess;

export type LoginResponse =
  | { token: string; role: "admin"; admin: { id: string; cpf: string } }
  | {
      token: string;
      role: "company";
      company: {
        id: string;
        name: string;
        cnpj: string;
        tool_access?: CompanyToolAccessApi;
        must_change_password?: boolean;
      };
    };

export const api = {
  auth: {
    login: (login: string, password: string) =>
      publicRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ login, password }),
      }),
    forgotPassword: (login: string, email: string) =>
      publicRequest<{ message: string }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ login, email }),
      }),
    checkResetToken: (token: string) =>
      publicRequest<{ valid: boolean }>(`/auth/reset-token?token=${encodeURIComponent(token)}`),
    resetPassword: (token: string, password: string) =>
      publicRequest<{ message: string }>("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      }),
    /** Trocar a senha estando logado (não depende de e-mail). */
    changePassword: (current_password: string, new_password: string) =>
      request<{ message: string }>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password, new_password }),
      }),
    /** Estando logado, pedir o link de redefinição para o e-mail já cadastrado. */
    sendResetLink: () =>
      request<{ message: string }>("/auth/send-reset-link", { method: "POST" }),
    /** Sessão de empresa: devolve tool_access atual (após admin alterar permissões). Requer Bearer. */
    companySession: () =>
      request<{ company: { id: string; name: string; cnpj: string }; tool_access: CompanyToolAccessApi }>(
        "/auth/company-session"
      ),
  },

  admin: {
    summary: () =>
      request<{
        companies: number;
        documents: number;
        employees: number;
        certificates: number;
        deliverables: number;
        deliverables_liberadas: number;
        deliverables_retidas: number;
      }>("/admin/summary"),
    /** Entregas (guias/folha/documentos) por empresa: liberadas × retidas. */
    deliverablesOverview: () =>
      request<
        Array<{
          id: string;
          name: string;
          cnpj: string;
          total: number;
          liberadas: number;
          retidas: number;
          ultima_entrada: string | null;
        }>
      >("/admin/deliverables-overview"),
    me: () =>
      request<{ id: string; cpf: string; contact_email: string | null }>("/admin/me"),
    updateMyContactEmail: (contact_email: string | null) =>
      request<{ ok: boolean; contact_email: string | null }>("/admin/me/contact-email", {
        method: "PATCH",
        body: JSON.stringify({ contact_email }),
      }),
    companies: () =>
      request<
        Array<{
          id: string;
          name: string;
          cnpj: string;
          contact_email: string | null;
          phone: string | null;
          tool_access: CompanyToolAccessApi;
          created_at: string;
        }>
      >("/admin/companies"),
    createCompany: (data: {
      name: string;
      cnpj: string;
      contact_email?: string | null;
      phone?: string | null;
    }) =>
      request<{
        company: {
          id: string;
          name: string;
          cnpj: string;
          contact_email: string | null;
          phone: string | null;
          tool_access: CompanyToolAccessApi;
          created_at: string;
        };
        message: string;
      }>("/admin/companies", { method: "POST", body: JSON.stringify(data) }),
    updateCompany: (
      companyId: string,
      data: {
        name?: string;
        contact_email?: string | null;
        phone?: string | null;
        tool_access?: CompanyToolAccessApi;
      }
    ) =>
      request<{
        id: string;
        name: string;
        cnpj: string;
        contact_email: string | null;
        phone: string | null;
        tool_access: CompanyToolAccessApi;
        created_at: string;
      }>(`/admin/companies/${companyId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    importEmployees: (
      companyId: string,
      rows: Array<{ name: string; cpf: string; pis?: string | null }>,
      fileCnpj: string
    ) =>
      request<{ inserted: number; skipped: number; errors: Array<{ row: number; message: string }> }>(
        `/admin/companies/${companyId}/import-employees`,
        { method: "POST", body: JSON.stringify({ rows, fileCnpj }) }
      ),

    /** Funcionários lidos do último extrato de folha da empresa (prévia). */
    extratoEmployees: (companyId: string) =>
      request<{
        competencia: string | null;
        arquivo: string;
        invalidos: number;
        total: number;
        novos: number;
        funcionarios: Array<{ codigo: string; name: string; cpf: string; jaCadastrado: boolean }>;
      }>(`/admin/companies/${companyId}/extrato-employees`),
    /** Cadastra os funcionários do extrato (uma empresa, ou todas se companyId omitido). */
    importExtratoEmployees: (companyId?: string) =>
      request<{
        inseridos: number;
        pulados: number;
        empresas: Array<{ name: string; inseridos?: number; pulados?: number; erro?: string }>;
      }>("/admin/extrato-employees/import", {
        method: "POST",
        body: JSON.stringify(companyId ? { company_id: companyId } : {}),
      }),
    /** Estado da sincronização com o G-Click. */
    syncStatus: () =>
      request<{
        configurado: boolean;
        rodando: boolean;
        ultima: {
          criados: number;
          atualizados: number;
          empresasCriadas: number;
          erros: number;
          segundos: number;
          em: string;
        } | null;
      }>("/admin/sync-gclick/status"),
    /** Dispara a sincronização com o G-Click (traz documentos e cria empresas que faltam). */
    runSync: (meses?: number) =>
      request<{ message: string }>("/admin/sync-gclick", {
        method: "POST",
        body: JSON.stringify(meses ? { meses } : {}),
      }),
    /** Dry-run: quantos funcionários o extrato traria por empresa, sem gravar. */
    scanExtratoEmployees: () =>
      request<{
        empresas_com_extrato: number;
        total_novos: number;
        empresas: Array<{ id: string; name: string; competencia: string | null; encontrados: number; novos: number }>;
      }>("/admin/extrato-employees/scan-all", { method: "POST" }),
  },

  employees: {
    list: (opts?: { companyId?: string }) => {
      const q =
        opts?.companyId && opts.companyId.length
          ? `?company_id=${encodeURIComponent(opts.companyId)}`
          : "";
      return request<
        Array<{
          id: string;
          name: string;
          cpf: string;
          pis: string | null;
          active: boolean;
          company_id: string;
          created_at: string;
          company_name?: string;
          company_cnpj?: string;
        }>
      >(`/employees${q}`);
    },
    create: (data: { company_id?: string; name: string; cpf: string; pis?: string | null; active?: boolean }) =>
      request("/employees", { method: "POST", body: JSON.stringify(data) }),
    import: (rows: Array<{ name: string; cpf: string; pis?: string | null }>, fileCnpj: string) =>
      request<{ inserted: number; skipped: number; errors: Array<{ row: number; message: string }> }>("/employees/import", {
        method: "POST",
        body: JSON.stringify({ rows, fileCnpj }),
      }),
    update: (id: string, data: { name?: string; cpf?: string; pis?: string | null; active?: boolean }) =>
      request(`/employees/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (id: string) =>
      request(`/employees/${id}`, { method: "DELETE" }),
  },

  documents: {
    list: (opts?: { companyId?: string }) => {
      const q =
        opts?.companyId && opts.companyId.length
          ? `?company_id=${encodeURIComponent(opts.companyId)}`
          : "";
      return request<Array<{
        id: string; document_type: string; employee_name: string; employee_cpf: string;
        employee_pis: string | null; company_name: string; company_cnpj: string; company_id: string | null;
        start_date: string | null; suspension_days: number | null; return_date: string | null;
        description: string | null; created_at: string;
      }>>(`/documents${q}`);
    },
    create: (data: Record<string, unknown>) =>
      request("/documents", { method: "POST", body: JSON.stringify(data) }),
    delete: (id: string) =>
      request(`/documents/${id}`, { method: "DELETE" }),
  },

  certificates: {
    list: (opts?: { companyId?: string; startDate?: string; endDate?: string }) => {
      let url = `/certificates`;
      const params: string[] = [];
      const companyId = opts?.companyId;
      if (companyId && companyId.length) params.push(`company_id=${encodeURIComponent(companyId)}`);
      if (opts?.startDate) params.push(`start_date=${opts.startDate}`);
      if (opts?.endDate) params.push(`end_date=${opts.endDate}`);
      if (params.length) url += `?${params.join("&")}`;
      return request<Array<{
        id: string; company_id: string; employee_id: string; file_path: string;
        file_name: string; certificate_date: string; notes: string | null;
        created_at: string; employee_name?: string; company_name?: string; company_cnpj?: string;
      }>>(url);
    },
    upload: async (formData: FormData) => {
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/certificates`, {
        method: "POST",
        body: formData,
        headers,
      });
      const data = await parseResponseJson<unknown>(res);
      if (res.status === 401) {
        localStorage.removeItem("company_session");
        window.location.href = "/login";
        throw new Error("Sessão expirada");
      }
      if (!res.ok) {
        const err = data as { error?: string };
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return data;
    },
    delete: (id: string) =>
      request(`/certificates/${id}`, { method: "DELETE" }),
    fileUrl: (filePath: string) => `${API_BASE}/certificates/file/${filePath}`,
  },

  /** Entregas da contabilidade: guias fiscais, folha e documentos avulsos. */
  deliverables: {
    list: (opts?: {
      companyId?: string;
      category?: DeliverableCategory;
      competencia?: string;
      status?: DeliverableStatus;
      from?: string;
      to?: string;
    }) => {
      const params = new URLSearchParams();
      if (opts?.companyId) params.set("company_id", opts.companyId);
      if (opts?.category) params.set("category", opts.category);
      if (opts?.competencia) params.set("competencia", opts.competencia);
      if (opts?.status) params.set("status", opts.status);
      if (opts?.from) params.set("from", opts.from);
      if (opts?.to) params.set("to", opts.to);
      const q = params.toString();
      return request<Deliverable[]>(`/deliverables${q ? `?${q}` : ""}`);
    },
    calendar: (opts?: { companyId?: string; from?: string; to?: string }) => {
      const params = new URLSearchParams();
      if (opts?.companyId) params.set("company_id", opts.companyId);
      if (opts?.from) params.set("from", opts.from);
      if (opts?.to) params.set("to", opts.to);
      const q = params.toString();
      return request<Deliverable[]>(`/deliverables/calendar${q ? `?${q}` : ""}`);
    },
    upcoming: (opts?: { companyId?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (opts?.companyId) params.set("company_id", opts.companyId);
      if (opts?.limit) params.set("limit", String(opts.limit));
      const q = params.toString();
      return request<Deliverable[]>(`/deliverables/upcoming${q ? `?${q}` : ""}`);
    },
    setStatus: (id: string, status: DeliverableStatus) =>
      request<Deliverable>(`/deliverables/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    delete: (id: string) => request<{ ok: boolean }>(`/deliverables/${id}`, { method: "DELETE" }),
    /** Blob autenticado — usar com `openDeliverableFile` (ver lib/openFile.ts). */
    fetchFile: (id: string) => requestBlob(`/deliverables/${id}/file`),
    adminUpload: async (formData: FormData) => {
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/deliverables`, { method: "POST", body: formData, headers });
      const data = await parseResponseJson<unknown>(res);
      if (res.status === 401) {
        localStorage.removeItem("company_session");
        window.location.href = "/login";
        throw new Error("Sessão expirada");
      }
      if (!res.ok) {
        const err = data as { error?: string };
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      // due_date_from_pdf: o portal leu a data do próprio PDF (upload sem data informada).
      return data as Deliverable & { due_date_from_pdf?: boolean };
    },
    /** Link do WhatsApp: token opaco, sem login. */
    public: {
      get: (token: string) => publicRequest<PublicDeliverable>(`/deliverables/public/${token}`),
      fileUrl: (token: string) => `${API_BASE}/deliverables/public/${token}/file`,
    },
  },
};
