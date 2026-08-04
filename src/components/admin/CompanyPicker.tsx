import { useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { maskCNPJ } from "@/lib/masks";
import { useAdminCompanies } from "@/hooks/useAdminCompanies";

/**
 * Escolha de empresa com **busca**.
 *
 * A carteira tem dezenas de clientes; num `select` de rolagem, achar um CNPJ vira
 * caça ao tesouro várias vezes por dia. Aqui dá para digitar parte do nome ou do CNPJ.
 * A busca ignora pontuação: "35736" acha "35.736.034/0001-23".
 */
export function CompanyPicker({
  value,
  onChange,
  placeholder = "Todas as empresas",
  allowAll = true,
  className,
}: {
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  allowAll?: boolean;
  className?: string;
}) {
  const { data: companies, isLoading } = useAdminCompanies();
  const [aberto, setAberto] = useState(false);

  const selecionada = companies?.find((c) => c.id === value);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={aberto}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className="truncate">
            {selecionada ? (
              <>
                {selecionada.name}
                <span className="ml-2 text-muted-foreground">{maskCNPJ(selecionada.cnpj)}</span>
              </>
            ) : (
              <span className="text-muted-foreground">
                {isLoading ? "Carregando empresas..." : placeholder}
              </span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          filter={(valorItem, busca) => {
            // O `value` de cada item é "nome cnpj"; comparar sem pontuação deixa
            // procurar por "35736" e achar "35.736.034/0001-23".
            const alvo = valorItem.toLowerCase();
            const termo = busca.toLowerCase().trim();
            if (!termo) return 1;
            const soDigitos = termo.replace(/\D/g, "");
            if (soDigitos && alvo.replace(/\D/g, "").includes(soDigitos)) return 1;
            return alvo.includes(termo) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Buscar por nome ou CNPJ..." />
          <CommandList>
            <CommandEmpty>
              <span className="flex items-center justify-center gap-2 text-sm">
                <Search className="h-4 w-4" /> Nenhuma empresa encontrada
              </span>
            </CommandEmpty>
            <CommandGroup>
              {allowAll && (
                <CommandItem
                  value="__todas__ todas as empresas"
                  onSelect={() => {
                    onChange("");
                    setAberto(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value ? "opacity-0" : "opacity-100")} />
                  Todas as empresas
                </CommandItem>
              )}
              {companies?.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.name} ${c.cnpj}`}
                  onSelect={() => {
                    onChange(c.id);
                    setAberto(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {c.name}
                    <span className="ml-2 text-xs text-muted-foreground">{maskCNPJ(c.cnpj)}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
