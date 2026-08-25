import { useState, useCallback } from "react";
import { mergeClientToolAccess, type CompanyToolAccess } from "@/lib/companyTools";
import { mergeAdminAreas, type AdminAreaAccess } from "@/lib/adminAreas";

export type EmpresaGrupo = {
  id: string;
  name: string;
  cnpj: string;
  is_matriz: boolean;
};

export type CompanySession = {
  role: "company";
  id: string;
  name: string;
  cnpj: string;
  token: string;
  toolAccess: CompanyToolAccess;
  /** Ainda com a senha inicial (= CNPJ): o portal exige a troca antes de liberar o resto. */
  mustChangePassword?: boolean;
  /** Tem funcionário celetista (não só pró-labore). Decide se "Férias" aparece. */
  temFuncionarios?: boolean;
  /** É a empresa-matriz do grupo (pode trocar para filiais). */
  isMatriz?: boolean;
  /** Lista de todas as empresas do grupo (a própria + filiais). Vem no login. */
  empresasGrupo?: EmpresaGrupo[];
  /** Marca que é uma sessão de personificação do admin */
  isAdminPersonified?: boolean;
};

export type AdminSession = {
  role: "admin";
  id: string;
  cpf: string;
  token: string;
  nome?: string | null;
  /** Dono do sistema: vê todas as áreas e é o único que gerencia usuários. */
  isOwner?: boolean;
  /** Áreas do painel liberadas. Ausente = login antigo, tratado como acesso total. */
  areas?: AdminAreaAccess;
  /** Senha definida pelo dono: troca obrigatória no 1º acesso. */
  mustChangePassword?: boolean;
};

export type AuthSession = CompanySession | AdminSession;

const STORAGE_KEY = "company_session";

function parseStored(): AuthSession | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const o = JSON.parse(stored) as Record<string, unknown>;
    if (!o?.token || typeof o.token !== "string") return null;

    if (o.role === "admin" && typeof o.id === "string" && typeof o.cpf === "string") {
      return {
        role: "admin",
        id: o.id,
        cpf: o.cpf,
        token: o.token,
        nome: typeof o.nome === "string" ? o.nome : null,
        isOwner: Boolean(o.isOwner ?? o.is_owner),
        // Sessão gravada antes das permissões existirem: acesso total, como era.
        areas: mergeAdminAreas(o.areas ?? null),
        mustChangePassword: Boolean(o.mustChangePassword ?? o.must_change_password),
      };
    }
    if (
      o.role === "company" &&
      typeof o.id === "string" &&
      typeof o.name === "string" &&
      typeof o.cnpj === "string"
    ) {
      return {
        role: "company",
        id: o.id,
        name: o.name,
        cnpj: o.cnpj,
        token: o.token,
        toolAccess: mergeClientToolAccess(o.toolAccess ?? o.tool_access),
        mustChangePassword: Boolean(o.mustChangePassword ?? o.must_change_password),
        // Ausente em sessões antigas: assume que tem, para não esconder à toa.
        temFuncionarios: o.temFuncionarios === undefined ? true : Boolean(o.temFuncionarios),
        isMatriz: Boolean(o.isMatriz ?? o.is_matriz),
        empresasGrupo: Array.isArray(o.empresasGrupo) ? o.empresasGrupo as EmpresaGrupo[] : [],
        // Sobrevive ao F5: sem isto, recarregar a página perdia a marca de personificação.
        isAdminPersonified: Boolean(o.isAdminPersonified),
      };
    }

    // Legado: sessão só de empresa sem campo role
    if (
      typeof o.id === "string" &&
      typeof o.name === "string" &&
      typeof o.cnpj === "string" &&
      o.token
    ) {
      return {
        role: "company",
        id: o.id,
        name: o.name,
        cnpj: o.cnpj,
        token: o.token,
        toolAccess: mergeClientToolAccess(o.toolAccess ?? o.tool_access),
        mustChangePassword: Boolean(o.mustChangePassword ?? o.must_change_password),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function useAuth() {
  const [session, setSession] = useState<AuthSession | null>(() => parseStored());

  const login = useCallback((data: AuthSession) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    setSession(data);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  /**
   * Troca a empresa ativa dentro do grupo (matriz/filial).
   * Chama a API, recebe novo token, atualiza localStorage e recarrega.
   */
  const trocarEmpresa = useCallback(async (companyId: string) => {
    if (!session || session.role !== "company") return;
    const empresasGrupo = session.empresasGrupo || [];

    try {
      const res = await fetch(
        `${(import.meta.env.VITE_API_URL as string || "/api").replace(/\/+$/, "")}/auth/trocar-empresa`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({ company_id: companyId }),
        }
      );
      if (!res.ok) throw new Error("Falha ao trocar empresa");
      const data = await res.json();

      const novaSession: CompanySession = {
        role: "company",
        id: data.company.id,
        name: data.company.name,
        cnpj: data.company.cnpj,
        token: data.token,
        toolAccess: mergeClientToolAccess(data.company.tool_access),
        mustChangePassword: Boolean(data.company.must_change_password),
        isMatriz: Boolean(data.is_matriz),
        empresasGrupo, // mantém a lista original (não muda ao trocar)
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(novaSession));
      setSession(novaSession);
      // Reload para atualizar todos os dados que dependem de company_id
      window.location.reload();
    } catch (err) {
      console.error("trocarEmpresa:", err);
    }
  }, [session]);

  const companySession = session?.role === "company" ? session : null;

  return {
    session,
    company: companySession,
    admin: session?.role === "admin" ? session : null,
    isAdmin: session?.role === "admin",
    isLoggedIn: !!session,
    empresasGrupo: companySession?.empresasGrupo || [],
    trocarEmpresa,
    login,
    logout,
  };
}
