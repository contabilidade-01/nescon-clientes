import { Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompanyPicker } from "@/components/admin/CompanyPicker";

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
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4" /> Empresa
        </CardTitle>
        {description && <p className="text-xs text-muted-foreground font-normal">{description}</p>}
      </CardHeader>
      <CardContent>
        <CompanyPicker
          value={value}
          onChange={onChange}
          allowAll={allowAll}
          className="w-full sm:max-w-md"
        />
      </CardContent>
    </Card>
  );
}
