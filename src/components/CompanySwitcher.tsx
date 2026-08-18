import { ChevronDown, Building2 } from "lucide-react";
import { useAuth, type EmpresaGrupo } from "@/hooks/useAuth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

/**
 * Seletor de empresa no header — só aparece se o grupo tem >1 empresa.
 *
 * O cliente loga na matriz e pode trocar para qualquer filial sem fazer login
 * novamente. A troca gera um novo token (via POST /auth/trocar-empresa) e
 * recarrega a página para refletir os dados da nova empresa.
 */
export function CompanySwitcher() {
  const { company, empresasGrupo, trocarEmpresa } = useAuth();

  // Sem grupo ou empresa isolada: não mostra nada
  if (!company || !empresasGrupo.length || empresasGrupo.length <= 1) return null;

  const empresaAtual = company.id;
  const outras = empresasGrupo.filter((e: EmpresaGrupo) => e.id !== empresaAtual);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2 h-8 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <Building2 className="h-3.5 w-3.5" />
          Trocar empresa
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-[280px]">
        {outras.map((emp: EmpresaGrupo) => (
          <DropdownMenuItem
            key={emp.id}
            onClick={() => trocarEmpresa(emp.id)}
            className="flex flex-col items-start gap-0.5 cursor-pointer"
          >
            <span className="text-sm font-medium truncate w-full">{emp.name}</span>
            <span className="text-[10px] text-muted-foreground">{emp.cnpj}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
