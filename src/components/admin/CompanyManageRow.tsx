import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import {
  COMPANY_TOOL_KEYS,
  COMPANY_TOOL_LABELS,
  mergeClientToolAccess,
  type CompanyToolAccess,
  type CompanyToolKey,
} from "@/lib/companyTools";
import { AdminEmployeeImport } from "@/components/AdminEmployeeImport";
import { AdminExtratoImport } from "@/components/AdminExtratoImport";
import { AdminDeliverableUpload } from "@/components/AdminDeliverableUpload";
import { AdminVacationImport } from "@/components/admin/AdminVacationImport";

/** Cadastro de uma empresa: razão social, contactos, permissões e importações. */
export function CompanyManageRow({
  company,
}: {
  company: {
    id: string;
    name: string;
    cnpj: string;
    contact_email: string | null;
    phone: string | null;
    tool_access: CompanyToolAccess;
    gclick_status?: string | null;
  };
}) {
  const [name, setName] = useState(company.name);
  const [email, setEmail] = useState(company.contact_email ?? "");
  const [phone, setPhone] = useState(company.phone ?? "");
  const [tools, setTools] = useState<CompanyToolAccess>(() => mergeClientToolAccess(company.tool_access));
  const [novaSenha, setNovaSenha] = useState("");

  useEffect(() => {
    setName(company.name);
    setEmail(company.contact_email ?? "");
    setPhone(company.phone ?? "");
    setTools(mergeClientToolAccess(company.tool_access));
  }, [company.name, company.contact_email, company.phone, company.tool_access]);

  const queryClient = useQueryClient();

  const mut = useMutation({
    mutationFn: () =>
      api.admin.updateCompany(company.id, {
        name: name.trim(),
        contact_email: email.trim() ? email.trim().toLowerCase() : null,
        phone: phone.replace(/\D/g, "") ? phone.replace(/\D/g, "") : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
      queryClient.invalidateQueries({ queryKey: ["issued-documents"] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success(`Razão social e dados de ${name.trim()} guardados`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveTools = useMutation({
    mutationFn: () => api.admin.updateCompany(company.id, { tool_access: tools }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
      toast.success("Permissões das ferramentas atualizadas");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const alterarSenha = useMutation({
    mutationFn: () => api.admin.alterarSenhaCliente(company.id, novaSenha.trim(), false),
    onSuccess: (r) => {
      toast.success(r.message);
      setNovaSenha("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleTool = (key: CompanyToolKey, checked: boolean) => {
    setTools((prev) => ({ ...prev, [key]: checked }));
  };

  return (
    <div className="rounded-lg border bg-card/50 p-4 space-y-3 scroll-mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-mono text-muted-foreground">CNPJ {company.cnpj}</p>
        {company.gclick_status === "DESATIVADO" && (
          // Só informa. O cliente continua acessando o portal — desligar é decisão
          // manual, feita nos switches de ferramentas abaixo.
          <Badge variant="destructive">Inativo no G-Click</Badge>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor={`razao-${company.id}`} className="text-xs font-semibold">
          Razão social
        </Label>
        <Input
          id={`razao-${company.id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Razão social conforme Receita Federal"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`email-${company.id}`} className="text-xs">
          E-mail (recuperação de senha)
        </Label>
        <Input id={`email-${company.id}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`tel-${company.id}`} className="text-xs">
          Telefone
        </Label>
        <Input
          id={`tel-${company.id}`}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="DDD + número"
        />
      </div>
      <Button type="button" size="sm" onClick={() => mut.mutate()} disabled={mut.isPending}>
        Guardar alterações
      </Button>

      {/* Alterar senha do cliente */}
      <div className="border-t pt-4 mt-4 space-y-2">
        <p className="text-xs font-semibold text-foreground">Alterar senha de acesso</p>
        <p className="text-xs text-muted-foreground">
          Defina uma nova senha para esta empresa. O cliente usará esta senha direto, sem precisar trocar.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1 flex-1 min-w-[180px]">
            <Label htmlFor={`senha-${company.id}`} className="text-xs">Nova senha</Label>
            <Input
              id={`senha-${company.id}`}
              type="text"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              placeholder="Mínimo 4 caracteres"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!novaSenha.trim() || novaSenha.trim().length < 4 || alterarSenha.isPending}
            onClick={() => alterarSenha.mutate()}
          >
            Alterar senha
          </Button>
        </div>
      </div>

      <div className="border-t pt-4 mt-4 space-y-3">
        <div>
          <p className="text-xs font-semibold text-foreground">Ferramentas no app da empresa</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ligue ou desligue o acesso a cada módulo (menu após login com CNPJ). O servidor aplica de imediato;
            ao abrir o início da aplicação, o menu sincroniza com estas permissões.
          </p>
        </div>
        <div className="space-y-3">
          {COMPANY_TOOL_KEYS.map((key) => {
            const meta = COMPANY_TOOL_LABELS[key];
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-3 rounded-md border bg-background/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight">{meta.title}</p>
                  <p className="text-xs text-muted-foreground">{meta.description}</p>
                </div>
                <Switch
                  checked={tools[key]}
                  onCheckedChange={(c) => toggleTool(key, c)}
                  aria-label={meta.title}
                />
              </div>
            );
          })}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => saveTools.mutate()}
          disabled={saveTools.isPending}
        >
          Guardar permissões das ferramentas
        </Button>
      </div>

      <AdminEmployeeImport
        companyId={company.id}
        companyCnpj={company.cnpj}
        companyName={company.name}
      />

      <AdminExtratoImport companyId={company.id} companyName={company.name} />

      <AdminVacationImport companyId={company.id} companyName={company.name} />

      <AdminDeliverableUpload companyId={company.id} companyName={company.name} />
    </div>
  );
}
