import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DatabaseBackup, HardDrive, History, Mail, UserPlus } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AdminSyncCard } from "@/components/AdminSyncCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

  // Padrão: janeiro do ano corrente — que é o pedido típico ("desde janeiro").
  const [desde, setDesde] = useState(`${new Date().getFullYear()}-01`);

  const tipos = useQuery({
    queryKey: ["gclick-tipos"],
    queryFn: () => api.admin.tiposGclick(),
  });

  // Vazio = tudo. O atalho "Só folha" existe porque é o caso real: o Extrato Mensal
  // alimenta os indicadores, e trazer um ano dele custa uma fração de trazer as guias.
  const [tiposEscolhidos, setTiposEscolhidos] = useState<Set<string>>(new Set());

  const cargaHistorica = useMutation({
    mutationFn: () =>
      api.admin.runSyncHistorico(desde, tiposEscolhidos.size ? [...tiposEscolhidos] : undefined),
    onSuccess: (r) => {
      toast.success(`Carga iniciada: ${r.competencias.length} competência(s).`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const backup = useQuery({
    queryKey: ["backup-config"],
    queryFn: () => api.admin.backupConfig(),
  });

  const salvarBackup = useMutation({
    mutationFn: (v: { ativo?: boolean; hora?: number; email?: string; whatsapp?: string }) =>
      api.admin.salvarBackupConfig(v),
    onSuccess: () => {
      toast.success("Backup configurado.");
      queryClient.invalidateQueries({ queryKey: ["backup-config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rodarBackup = useMutation({
    mutationFn: () => api.admin.executarBackup(),
    onSuccess: (r) => {
      if (r.erro) return toast.error(r.erro);
      if (!r.ok) return toast.error(`Backup com problema: ${r.problemas?.join(" ")}`);
      toast.success(`Backup ${r.tamanho} · e-mail ${r.entregas?.email} · WhatsApp ${r.entregas?.whatsapp}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const integridade = useQuery({
    queryKey: ["arquivos-integridade"],
    queryFn: () => api.admin.integridadeArquivos(),
  });

  const rebaixar = useMutation({
    mutationFn: () => api.admin.rebaixarArquivos(),
    onSuccess: (r) => {
      toast.success(r.message);
      queryClient.invalidateQueries({ queryKey: ["arquivos-integridade"] });
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

      {/* Carga de arquivo, não de cobrança. A distinção é o ponto do cartão inteiro. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Carga histórica
          </CardTitle>
          <p className="text-xs font-normal text-muted-foreground">
            Traz as competências já encerradas para o cliente ter o arquivo no portal —
            folha, INSS, FGTS, DAS e o que mais existir na esteira. Os documentos entram
            <strong> visíveis e marcados como histórico</strong>: aparecem na listagem e no
            calendário, mas <strong>não entram em "próximos pagamentos"</strong> nem contam
            como atrasados. O mês corrente fica de fora, porque guia deste mês pode estar
            realmente a vencer.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-xs">O que trazer</Label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  setTiposEscolhidos(
                    new Set(
                      (tipos.data ?? [])
                        .filter((t) => t.categoria === "folha")
                        .map((t) => t.codigo)
                    )
                  )
                }
              >
                Só folha (alimenta os indicadores)
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  setTiposEscolhidos(
                    new Set((tipos.data ?? []).filter((t) => t.categoria === "guia").map((t) => t.codigo))
                  )
                }
              >
                Só guias
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setTiposEscolhidos(new Set())}
              >
                Tudo
              </Button>
            </div>
            <div className="flex flex-wrap gap-3 rounded-md border p-3">
              {(tipos.data ?? []).map((t) => (
                <label key={t.codigo} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={tiposEscolhidos.size === 0 || tiposEscolhidos.has(t.codigo)}
                    onCheckedChange={(v) =>
                      setTiposEscolhidos((prev) => {
                        // Nada marcado significa "tudo"; o primeiro clique parte de tudo
                        // marcado para o usuário desmarcar o que não quer.
                        const base =
                          prev.size === 0
                            ? new Set((tipos.data ?? []).map((x) => x.codigo))
                            : new Set(prev);
                        if (v) base.add(t.codigo);
                        else base.delete(t.codigo);
                        return base;
                      })
                    }
                  />
                  <span>{t.nome}</span>
                  {t.categoria === "folha" && (
                    <Badge variant="outline" className="text-[10px]">
                      folha
                    </Badge>
                  )}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {tiposEscolhidos.size === 0
                ? "Nada marcado = traz tudo."
                : `${tiposEscolhidos.size} tipo(s) selecionado(s).`}
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="hist-desde" className="text-xs">
              A partir da competência
            </Label>
            <Input
              id="hist-desde"
              type="month"
              className="h-9 w-44"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            onClick={() => cargaHistorica.mutate()}
            disabled={!desde || cargaHistorica.isPending}
          >
            {cargaHistorica.isPending ? "Iniciando…" : "Trazer histórico"}
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            A carga roda em segundo plano e pode levar minutos — acompanhe pelo cartão de
            sincronização acima.
          </p>
          </div>
        </CardContent>
      </Card>

      {/* O banco e o unico dado que nao volta sozinho. Dai o cartao vir antes do de
          arquivos: a prioridade nao e obvia e a tela deve deixa-la clara. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <DatabaseBackup className="h-4 w-4" /> Backup do banco
          </CardTitle>
          <p className="text-xs font-normal text-muted-foreground">
            Todo dia o portal gera um dump, <strong>confere se ele está íntegro</strong> e
            manda o arquivo <strong>cifrado por e-mail</strong>. O WhatsApp recebe só o
            resumo com os números — é o que faz alguém perceber quando parar de chegar.
            O arquivo não vai por WhatsApp porque carrega CPF, salário e telefone de
            terceiros.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {!backup.data?.senha_configurada && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
              Falta <code>BACKUP_SENHA</code> no ambiente (mínimo 12 caracteres). Sem ela
              não há como cifrar — e sem cifrar não mando. <strong>Guarde essa senha fora
              do servidor</strong>: sem ela o backup é um arquivo inútil.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-3">
              <Switch
                id="backup-ativo"
                checked={Boolean(backup.data?.ativo)}
                disabled={!backup.data?.senha_configurada || salvarBackup.isPending}
                onCheckedChange={(v) => salvarBackup.mutate({ ativo: v })}
              />
              <Label htmlFor="backup-ativo" className="font-normal">
                Backup diário
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="backup-hora" className="text-sm font-normal">
                às
              </Label>
              <Input
                id="backup-hora"
                type="number"
                min={0}
                max={23}
                className="h-9 w-20"
                defaultValue={backup.data?.hora ?? 3}
                onBlur={(e) => {
                  const h = Number(e.target.value);
                  if (Number.isInteger(h) && h >= 0 && h <= 23 && h !== backup.data?.hora) {
                    salvarBackup.mutate({ hora: h });
                  }
                }}
              />
              <span className="text-sm text-muted-foreground">h</span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="backup-email" className="text-xs">
                E-mail que recebe o arquivo
              </Label>
              <Input
                id="backup-email"
                type="email"
                placeholder="backup@nescon.com.br"
                defaultValue={backup.data?.email ?? ""}
                onBlur={(e) => {
                  if (e.target.value.trim() !== (backup.data?.email ?? "")) {
                    salvarBackup.mutate({ email: e.target.value.trim() });
                  }
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="backup-wpp" className="text-xs">
                WhatsApp que recebe o resumo
              </Label>
              <Input
                id="backup-wpp"
                inputMode="numeric"
                placeholder="34999998888"
                defaultValue={backup.data?.whatsapp ?? ""}
                onBlur={(e) => {
                  if (e.target.value.trim() !== (backup.data?.whatsapp ?? "")) {
                    salvarBackup.mutate({ whatsapp: e.target.value.trim() });
                  }
                }}
              />
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => rodarBackup.mutate()}
            disabled={!backup.data?.senha_configurada || rodarBackup.isPending}
          >
            {rodarBackup.isPending ? "Gerando…" : "Fazer backup agora"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Rodar agora é também o teste: se funcionar aqui, a rotina diária faz o mesmo.
            Para abrir o arquivo depois:{" "}
            <code>node scripts/restaurar-backup.cjs &lt;arquivo&gt;</code>
          </p>
        </CardContent>
      </Card>

      {/* O volume de uploads nao tem backup. A saida nao e copiar PDF: e saber que
          quase tudo dele volta do G-Click. O que nao volta e o BANCO. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDrive className="h-4 w-4" /> Arquivos no disco
          </CardTitle>
          <p className="text-xs font-normal text-muted-foreground">
            Confere se cada entrega ainda tem o PDF no volume. O que veio do G-Click é
            recuperável — dá para baixar de novo. Upload manual do escritório, não: se o
            arquivo sumiu, só reenviando.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Entregas", valor: integridade.data?.total ?? 0 },
              { label: "Com arquivo", valor: integridade.data?.ok ?? 0 },
              { label: "Recuperáveis", valor: integridade.data?.recuperaveis ?? 0 },
              { label: "Perdidos", valor: integridade.data?.perdidos ?? 0 },
            ].map((c) => (
              <div key={c.label} className="rounded-md border p-3">
                <p className="text-xl font-bold tabular-nums">{c.valor}</p>
                <p className="text-xs text-muted-foreground">{c.label}</p>
              </div>
            ))}
          </div>
          {(integridade.data?.recuperaveis ?? 0) > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => rebaixar.mutate()}
              disabled={rebaixar.isPending}
            >
              Marcar {integridade.data?.recuperaveis} para rebaixar
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Marcar não baixa nada: apaga a marca de versão, e a próxima sincronização
            refaz o download pelo caminho de sempre.
          </p>
        </CardContent>
      </Card>

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
