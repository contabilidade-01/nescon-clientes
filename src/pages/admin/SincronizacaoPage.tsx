import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AdminSyncCard } from "@/components/AdminSyncCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  return (
    <AdminLayout
      title="Sincronização e conta"
      description="Carga de documentos do G-Click e dados do administrador"
    >
      <AdminSyncCard />

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
