import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Plus, ShieldCheck, UserCog } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, type AdminUser } from "@/lib/api";
import { maskCPF } from "@/lib/masks";
import {
  ADMIN_AREAS,
  ADMIN_AREA_LABELS,
  mergeAdminAreas,
  type AdminAreaAccess,
} from "@/lib/adminAreas";

const SEM_AREAS: AdminAreaAccess = mergeAdminAreas({});

/** Senha inicial e redefinições aparecem uma única vez — depois só o hash fica guardado. */
function SenhaDialog({ senha, onClose }: { senha: string | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(senha)} onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Senha definida</DialogTitle>
          <DialogDescription>
            Anote agora e passe à pessoa por um canal seguro. Esta senha <strong>não aparece de
            novo</strong> — depois daqui, só dá para redefinir. No primeiro acesso o sistema exige a
            troca.
          </DialogDescription>
        </DialogHeader>
        <p className="select-all rounded-lg border bg-muted/40 px-4 py-3 text-center font-mono text-lg">
          {senha}
        </p>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Já anotei
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const UsuariosPage = () => {
  const queryClient = useQueryClient();
  const [senhaExibida, setSenhaExibida] = useState<string | null>(null);

  const [novoNome, setNovoNome] = useState("");
  const [novoCpf, setNovoCpf] = useState("");
  const [novasAreas, setNovasAreas] = useState<AdminAreaAccess>(SEM_AREAS);

  const { data: usuarios, isLoading } = useQuery({
    queryKey: ["admin-usuarios"],
    queryFn: () => api.admin.usuarios.listar(),
  });

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ["admin-usuarios"] });

  const criar = useMutation({
    mutationFn: () =>
      api.admin.usuarios.criar({
        cpf: novoCpf.replace(/\D/g, ""),
        nome: novoNome.trim(),
        areas: novasAreas,
      }),
    onSuccess: (r) => {
      invalidar();
      setSenhaExibida(r.senha_inicial);
      setNovoNome("");
      setNovoCpf("");
      setNovasAreas(SEM_AREAS);
      toast.success("Usuário criado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AdminLayout
      title="Usuários do painel"
      description="Quem entra no painel e o que cada um pode ver"
    >
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4" /> Novo usuário
          </CardTitle>
          <CardDescription>
            Login por <strong>CPF</strong>. O sistema gera a senha inicial e mostra uma vez; a
            pessoa é obrigada a trocá-la no primeiro acesso. Marque só as áreas que ela precisa —
            usuário novo nasce <strong>sem nenhuma</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Nome</Label>
              <Input
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                placeholder="Ex.: Nelson"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">CPF</Label>
              <Input
                value={novoCpf}
                onChange={(e) => setNovoCpf(maskCPF(e.target.value.replace(/\D/g, "").slice(0, 11)))}
                placeholder="000.000.000-00"
              />
            </div>
          </div>

          <AreasEditor areas={novasAreas} onChange={setNovasAreas} />

          <Button
            type="button"
            onClick={() => criar.mutate()}
            disabled={
              criar.isPending || !novoNome.trim() || novoCpf.replace(/\D/g, "").length !== 11
            }
          >
            Criar usuário
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <UserCog className="h-4 w-4" /> Usuários
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : (
            usuarios?.map((u) => (
              <UsuarioRow key={u.id} usuario={u} onSenha={setSenhaExibida} onSalvo={invalidar} />
            ))
          )}
        </CardContent>
      </Card>

      <SenhaDialog senha={senhaExibida} onClose={() => setSenhaExibida(null)} />
    </AdminLayout>
  );
};

/** Grade de switches, uma por área do painel. */
function AreasEditor({
  areas,
  onChange,
  disabled,
}: {
  areas: AdminAreaAccess;
  onChange: (a: AdminAreaAccess) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {ADMIN_AREAS.map((key) => {
        const meta = ADMIN_AREA_LABELS[key];
        return (
          <div
            key={key}
            className="flex items-center justify-between gap-3 rounded-md border bg-background/60 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium leading-tight">{meta.title}</p>
              <p className="truncate text-xs text-muted-foreground">{meta.description}</p>
            </div>
            <Switch
              checked={areas[key]}
              disabled={disabled}
              onCheckedChange={(v) => onChange({ ...areas, [key]: v })}
              aria-label={meta.title}
            />
          </div>
        );
      })}
    </div>
  );
}

function UsuarioRow({
  usuario,
  onSenha,
  onSalvo,
}: {
  usuario: AdminUser;
  onSenha: (s: string) => void;
  onSalvo: () => void;
}) {
  const [areas, setAreas] = useState<AdminAreaAccess>(() => mergeAdminAreas(usuario.areas));
  const [aberto, setAberto] = useState(false);

  const salvar = useMutation({
    mutationFn: () => api.admin.usuarios.atualizar(usuario.id, { areas }),
    onSuccess: () => {
      onSalvo();
      toast.success(`Permissões de ${usuario.nome || usuario.cpf} atualizadas`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const alternarAtivo = useMutation({
    mutationFn: () => api.admin.usuarios.atualizar(usuario.id, { active: !usuario.active }),
    onSuccess: () => {
      onSalvo();
      toast.success(usuario.active ? "Acesso desativado" : "Acesso reativado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const redefinir = useMutation({
    mutationFn: () => api.admin.usuarios.redefinirSenha(usuario.id),
    onSuccess: (r) => onSenha(r.senha_inicial),
    onError: (e: Error) => toast.error(e.message),
  });

  const liberadas = ADMIN_AREAS.filter((a) => areas[a]).length;

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {usuario.nome || "(sem nome)"}{" "}
            <span className="font-mono text-xs text-muted-foreground">{maskCPF(usuario.cpf)}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {usuario.is_owner
              ? "Dono — vê todas as áreas"
              : `${liberadas} de ${ADMIN_AREAS.length} áreas liberadas`}
            {usuario.must_change_password ? " · senha a trocar no 1º acesso" : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {usuario.is_owner && (
            <Badge variant="default" className="gap-1">
              <ShieldCheck className="h-3 w-3" /> Dono
            </Badge>
          )}
          {!usuario.active && <Badge variant="destructive">Desativado</Badge>}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => redefinir.mutate()}
            disabled={redefinir.isPending}
          >
            <KeyRound className="mr-1 h-3.5 w-3.5" /> Nova senha
          </Button>
          {!usuario.is_owner && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => alternarAtivo.mutate()}
                disabled={alternarAtivo.isPending}
              >
                {usuario.active ? "Desativar" : "Reativar"}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setAberto((v) => !v)}>
                {aberto ? "Fechar" : "Permissões"}
              </Button>
            </>
          )}
        </div>
      </div>

      {aberto && !usuario.is_owner && (
        <div className="mt-3 space-y-3 border-t pt-3">
          <AreasEditor areas={areas} onChange={setAreas} />
          <Button type="button" size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            Guardar permissões
          </Button>
        </div>
      )}
    </div>
  );
}

export default UsuariosPage;
