import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, UserPlus } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AdminSyncCard } from "@/components/AdminSyncCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";

const SincronizacaoPage = () => {
  const queryClient = useQueryClient();

  const { data: adminMe } = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => api.admin.me(),
  });

  const [adminEmail, setAdminEmail] = useState("");
  useEffect(() => {
    setAdminEmail(adminMe?.contact_email ?? "");
  }, [adminMe?.contact_email]);

  const saveAdminEmail = useMutation({
    mutationFn: () =>
      api.admin.updateMyContactEmail(adminEmail.trim() ? adminEmail.trim().toLowerCase() : null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-me"] });
      toast.success("E-mail do administrador atualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: config } = useQuery({
    queryKey: ["config-sync"],
    queryFn: () => api.admin.configSync(),
  });

  const salvarConfig = useMutation({
    mutationFn: (v: boolean) => api.admin.salvarConfigSync(v),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["config-sync"] });
      toast.success(
        r.alerta_so_ativos
          ? "Só clientes ativos passam a gerar alerta de cadastro"
          : "Clientes desativados também passam a gerar alerta"
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const conferirClientes = useMutation({
    mutationFn: () => api.gclickClientes.sincronizar(),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["gclick-pendencias"] });
      toast.success(
        `${r.clientes} cliente(s) conferido(s) · ${r.novos} novo(s) no espelho · ${r.alertas} alerta(s)`
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AdminLayout
      title="Sincronização e conta"
      description="Carga de documentos do G-Click e dados do administrador"
    >
      <AdminSyncCard />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Clientes do G-Click
          </CardTitle>
          <p className="text-xs font-normal text-muted-foreground">
            Confere a lista de clientes sem baixar documentos — leva segundos. Clientes novos e
            mudanças de situação aparecem em <strong>Clientes do G-Click</strong>.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-md border bg-background/60 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium leading-tight">Alertar só sobre clientes ativos</p>
              <p className="text-xs text-muted-foreground">
                Cliente que já chega desativado no G-Click entra na lista, mas não gera alerta de
                cadastro. A conferência sempre olha todos — sem os desativados não haveria como
                perceber que alguém foi desativado.
              </p>
            </div>
            <Switch
              checked={config?.alerta_so_ativos ?? true}
              disabled={!config || salvarConfig.isPending}
              onCheckedChange={(v) => salvarConfig.mutate(v)}
              aria-label="Alertar só sobre clientes ativos"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => conferirClientes.mutate()}
            disabled={conferirClientes.isPending}
          >
            Conferir clientes agora
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" /> Seu e-mail (recuperação de senha)
          </CardTitle>
          <p className="text-xs font-normal text-muted-foreground">
            Usado em &quot;Esqueci minha senha&quot; com o seu CPF de administrador. Sem e-mail
            cadastrado, a recuperação automática não funciona.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <Label htmlFor="admin-contact-email" className="text-xs">
              E-mail
            </Label>
            <Input
              id="admin-contact-email"
              type="email"
              placeholder="admin@empresa.com"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <Button type="button" onClick={() => saveAdminEmail.mutate()} disabled={saveAdminEmail.isPending}>
            Guardar
          </Button>
        </CardContent>
      </Card>
    </AdminLayout>
  );
};

export default SincronizacaoPage;
