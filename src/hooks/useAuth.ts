import { useState, useCallback } from "react";
import { mergeClientToolAccess, type CompanyToolAccess } from "@/lib/companyTools";
import { mergeAdminAreas, type AdminAreaAccess } from "@/lib/adminAreas";

export type CompanySession = {
  role: "company";
  id: string;
  name: string;
  cnpj: string;
  token: string;
  toolAccess: CompanyToolAccess;
  /** Ainda com a senha inicial (= CNPJ): o portal exige a troca antes de liberar o resto. */
  mustChangePassword?: boolean;
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

  return {
    session,
    company: session?.role === "company" ? session : null,
    admin: session?.role === "admin" ? session : null,
    isAdmin: session?.role === "admin",
    isLoggedIn: !!session,
    login,
    logout,
  };
}
