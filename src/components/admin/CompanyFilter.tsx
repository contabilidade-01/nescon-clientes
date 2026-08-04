import { Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAdminCompanies } from "@/hooks/useAdminCompanies";

/** Filtro de empresa reutilizado pelas páginas do painel. Valor "" = todas. */
export function CompanyFilter({
  value,
  onChange,
  description,
  allowAll = true,
}: {
  value: string;
  onChange: (id: string) => void;
  description?: string;
  allowAll?: boolean;
}) {
  const { data: companies } = useAdminCompanies();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4" /> Empresa
        </CardTitle>
        {description && <p className="text-xs text-muted-foreground font-normal">{description}</p>}
      </CardHeader>
      <CardContent>
        <Select
          value={value || "__all__"}
          onValueChange={(v) => onChange(v === "__all__" ? "" : v)}
        >
          <SelectTrigger className="w-full sm:max-w-md">
            <SelectValue placeholder="Empresa" />
          </SelectTrigger>
          <SelectContent>
            {allowAll && <SelectItem value="__all__">Todas as empresas</SelectItem>}
            {companies?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <span className="font-medium">{c.name}</span>
                <span className="text-muted-foreground"> · {c.cnpj}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}
