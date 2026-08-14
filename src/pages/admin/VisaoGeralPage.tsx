import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  ClipboardCheck,
  MessageCircle,
  ShieldCheck,
  UserPlus,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { canSeeArea } from "@/lib/adminAreas";
import { useGclickPendencias } from "@/hooks/useGclickPendencias";
import { LICENSE_STATUS_LABELS } from "@/lib/licenses";

/** Cartão-número clicável: leva ao segmento correspondente do painel. */
function StatCard({
  label,
  value,
  hint,
  onClick,
}: {
  label: string;
  value: number | string;
  hint?: string;
  onClick?: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      className={onClick ? "cursor-pointer transition-colors hover:border-primary/40" : undefined}
    >
      <CardContent className="pt-4 pb-4 text-left">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** Horas → "3 h" / "2 d". Fila vazia mostra travessão em vez de "0 h". */
function esperaLabel(horas: number): string {
  if (!horas || horas <= 0) return "—";
  if (horas < 24) return `${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "1 d" : `${dias} d`;
}

/**
 * Interruptor do modo manutenção — só o dono. Ligado, o cliente não entra (login e sessão
 * bloqueados) e vê a mensagem; o admin continua acessando normalmente.
 */
function ManutencaoCard() {
  const queryClient = useQueryClient();
  const [mensagem, setMensagem] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["admin-manutencao"],
    queryFn: () => api.admin.getManutencao(),
  });

  const salvar = useMutation({
    mutationFn: (v: { ativo?: boolean; mensagem?: string }) => api.admin.setManutencao(v),
    onSuccess: (r) => {
      queryClient.setQueryData(["admin-manutencao"], r);
      setMensagem(null);
      toast.success(r.ativo ? "Modo manutenção LIGADO — clientes bloqueados." : "Modo manutenção desligado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ativo = Boolean(data?.ativo);
  const valorCampo = mensagem ?? data?.mensagem ?? "";

  return (
    <Card className={ativo ? "border-amber-500/60 bg-amber-500/5" : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Wrench className="h-4 w-4" /> Modo manutenção
        </CardTitle>
        <CardDescription>
          Ligado, o cliente não entra no portal e vê a mensagem abaixo. Você (admin) continua
          acessando para desligar quando terminar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">
            {ativo ? "Portal fechado para clientes" : "Portal aberto normalmente"}
          </span>
          <Switch
            checked={ativo}
            disabled={salvar.isPending}
            onCheckedChange={(v) => salvar.mutate({ ativo: v })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Mensagem exibida ao cliente</label>
          <div className="flex gap-2">
            <Input
              value={valorCampo}
              maxLength={500}
              placeholder="Deixe em branco para usar a mensagem padrão"
              onChange={(e) => setMensagem(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={salvar.isPending || mensagem === null}
              onClick={() => salvar.mutate({ mensagem: valorCampo })}
            >
              Salvar texto
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const VisaoGeralPage = () => {
  const navigate = useNavigate();
  const { admin } = useAuth();
  // Usuário sem a área não deve nem consultar: a rota responderia 403 e a tela
  // mostraria erro por algo que ele simplesmente não pode ver.
  const podeLicencas = canSeeArea("licencas", admin?.areas, admin?.isOwner);
  const podeLgpd = canSeeArea("lgpd", admin?.areas, admin?.isOwner);
  const podeEmpresas = canSeeArea("empresas", admin?.areas, admin?.isOwner);
  const podeEntregas = canSeeArea("entregas", admin?.areas, admin?.isOwner);
  const podeFuncionarios = canSeeArea("funcionarios", admin?.areas, admin?.isOwner);
  const podeAtendimento = canSeeArea("atendimento", admin?.areas, admin?.isOwner);
  const { data: pendencias } = useGclickPendencias();

  // Resumo do atendimento. O servidor já devolve só o que ESTE usuário pode ver, então
  // o painel nunca mostra conversa de colega — nem no número.
  const { data: atendimentos } = useQuery({
    queryKey: ["admin-atendimentos-summary"],
    queryFn: () => api.atendimentos.summary(),
    enabled: podeAtendimento,
    refetchInterval: 60_000,
  });

  const { data: cobertura } = useQuery({
    queryKey: ["cobertura"],
    queryFn: () => api.admin.cobertura(),
  });

  const { data: summary } = useQuery({
    queryKey: ["admin-summary"],
    queryFn: () => api.admin.summary(),
  });

  const { data: licencas } = useQuery({
    queryKey: ["licencas-overview"],
    queryFn: () => api.licencas.overview(),
    enabled: podeLicencas,
  });

  const { data: lgpd } = useQuery({
    queryKey: ["lgpd-consents"],
    queryFn: () => api.admin.lgpdConsents(),
    enabled: podeLgpd,
  });

  const atencao = (licencas?.por_status.vencida ?? 0) + (licencas?.por_status.a_vencer ?? 0);

  return (
    <AdminLayout
      title="Visão geral"
      description="Resumo do escritório: cadastro, entregas, licenças e conformidade"
    >
      {/* Interruptor global: só o dono. Fica no topo por ser a ação de maior impacto. */}
      {admin?.isOwner && <ManutencaoCard />}

      {/* Faixa fixa: fica no topo até a decisão ser tomada. O aviso ao entrar pode ser
          fechado; esta não sai sozinha — é a única forma de saber que entrou cliente novo. */}
      {(pendencias?.total ?? 0) > 0 && (
        <button
          type="button"
          onClick={() => navigate("/admin/clientes-gclick")}
          className="flex w-full items-center gap-3 rounded-xl border-2 border-primary bg-primary/10 px-4 py-4 text-left"
        >
          <UserPlus className="h-6 w-6 shrink-0 text-primary" />
          <span className="flex-1">
            <span className="block font-semibold">
              {pendencias!.novos_count > 0
                ? `${pendencias!.novos_count} cliente(s) novo(s) do G-Click aguardando decisão`
                : `${pendencias!.mudancas_count} mudança(s) de situação para revisar`}
            </span>
            <span className="block text-sm text-muted-foreground">
              {pendencias!.novos_count > 0 && pendencias!.mudancas_count > 0
                ? `E mais ${pendencias!.mudancas_count} mudança(s) de situação. `
                : ""}
              Clique para cadastrar, recusar ou dar ciência.
            </span>
          </span>
          <ArrowUpRight className="h-5 w-5 shrink-0 text-primary" />
        </button>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard
          label="Empresas"
          value={summary?.companies ?? "—"}
          onClick={podeEmpresas ? () => navigate("/admin/empresas") : undefined}
        />
        <StatCard
          label="Entregas (guias/folha)"
          value={summary?.deliverables ?? "—"}
          hint={
            summary
              ? `${summary.deliverables_liberadas} liberadas · ${summary.deliverables_retidas} retidas`
              : undefined
          }
          onClick={podeEntregas ? () => navigate("/admin/entregas") : undefined}
        />
        <StatCard
          label="Docs DP (susp./advert.)"
          value={summary?.documents ?? "—"}
          onClick={podeEntregas ? () => navigate("/admin/entregas") : undefined}
        />
        <StatCard
          label="Funcionários"
          value={summary?.employees ?? "—"}
          onClick={podeFuncionarios ? () => navigate("/admin/funcionarios") : undefined}
        />
        <StatCard
          label="Atestados"
          value={summary?.certificates ?? "—"}
          onClick={podeEntregas ? () => navigate("/admin/entregas") : undefined}
        />
      </section>

      {podeAtendimento && (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageCircle className="h-4 w-4" /> Atendimento
          </CardTitle>
          <CardDescription>
            Mensagens dos clientes no portal. &quot;Sem resposta&quot; é a fila de quem
            ainda não foi atendido por ninguém.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => navigate("/admin/atendimentos?status=aberto")}
            className="rounded-xl border bg-background/60 p-3 text-left transition-colors hover:border-primary/40"
          >
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-destructive" /> Sem resposta
            </span>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {atendimentos?.na_fila ?? "—"}
            </p>
          </button>

          <button
            type="button"
            onClick={() => navigate("/admin/atendimentos?status=em_atendimento")}
            className="rounded-xl border bg-background/60 p-3 text-left transition-colors hover:border-primary/40"
          >
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-amber-500" /> Em atendimento
            </span>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {atendimentos?.em_atendimento ?? "—"}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {atendimentos ? `${atendimentos.meus} comigo` : ""}
            </p>
          </button>

          <button
            type="button"
            onClick={() => navigate("/admin/atendimentos?status=resolvido")}
            className="rounded-xl border bg-background/60 p-3 text-left transition-colors hover:border-primary/40"
          >
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Resolvidos hoje
            </span>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {atendimentos?.resolvidos_hoje ?? "—"}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {atendimentos ? `${atendimentos.resolvidos_7d} em 7 dias` : ""}
            </p>
          </button>

          {/* Espera mais antiga: o contador diz QUANTAS aguardam, este diz HÁ QUANTO
              TEMPO. Uma conversa parada há dois dias é pior que cinco de dez minutos. */}
          <div className="rounded-xl border bg-background/60 p-3 text-left">
            <span className="text-xs text-muted-foreground">Espera mais antiga</span>
            <p
              className={`mt-1 text-2xl font-bold tabular-nums ${
                (atendimentos?.espera_mais_antiga_h ?? 0) >= 24 ? "text-destructive" : ""
              }`}
            >
              {atendimentos ? esperaLabel(atendimentos.espera_mais_antiga_h) : "—"}
            </p>
          </div>
        </CardContent>
      </Card>
      )}

      {podeLicencas && (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Licenças
          </CardTitle>
          <CardDescription>
            {licencas
              ? `${licencas.estabelecidas} empresas estabelecidas (${licencas.nao_estabelecidas} não estabelecidas ficam fora deste controle). Aviso de vencimento com ${licencas.dias_aviso} dias de antecedência.`
              : "Carregando..."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["vencida", "a_vencer", "ativa", "ausente"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => navigate(`/admin/licencas?status=${s}`)}
              className="rounded-xl border bg-background/60 p-3 text-left transition-colors hover:border-primary/40"
            >
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`h-2 w-2 rounded-full ${LICENSE_STATUS_LABELS[s].dot}`} />
                {LICENSE_STATUS_LABELS[s].title}
              </span>
              <p className="mt-1 text-2xl font-bold tabular-nums">{licencas?.por_status[s] ?? "—"}</p>
            </button>
          ))}
        </CardContent>
      </Card>
      )}

      {podeLicencas && atencao > 0 && (
        <button
          type="button"
          onClick={() => navigate("/admin/licencas?status=vencida")}
          className="flex w-full items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-left"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
          <span className="flex-1 text-sm">
            <strong>{atencao}</strong> licença(s) vencida(s) ou a vencer precisam de providência.
          </span>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      )}

      {/* Cobertura: cada número aqui é uma fila de trabalho. Antes, saber quais
          empresas faltavam exigia abrir uma a uma. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4" /> Cobertura operacional
          </CardTitle>
          <CardDescription>
            O que ainda falta cadastrar. Licenças só contam empresas estabelecidas; férias, só
            quem tem funcionário celetista.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Pendencia
            rotulo="Sem licença cadastrada"
            total={cobertura?.sem_licenca.total}
            de={cobertura?.estabelecidas}
            empresas={cobertura?.sem_licenca.empresas}
            onClick={podeLicencas ? () => navigate("/admin/licencas?status=ausente") : undefined}
          />
          <Pendencia
            rotulo="Sem programação de férias"
            total={cobertura?.sem_programacao_ferias.total}
            de={cobertura?.com_funcionarios}
            empresas={cobertura?.sem_programacao_ferias.empresas}
            onClick={podeEmpresas ? () => navigate("/admin/empresas") : undefined}
          />
          <Pendencia
            rotulo="Extrato ainda não lido"
            total={cobertura?.sem_extrato_lido.total}
            de={cobertura?.empresas}
            empresas={cobertura?.sem_extrato_lido.empresas}
            onClick={podeFuncionarios ? () => navigate("/admin/funcionarios") : undefined}
          />
        </CardContent>
      </Card>

      {podeLgpd && (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Consentimentos LGPD</CardTitle>
          <CardDescription>
            Aceite do cliente ao termo de tratamento de dados, registrado no primeiro acesso.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          {(["aceito", "visto", "pendente"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => navigate("/admin/lgpd")}
              className="rounded-xl border bg-background/60 p-3 text-left transition-colors hover:border-primary/40"
            >
              <p className="text-xs capitalize text-muted-foreground">{k}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{lgpd?.resumo[k] ?? "—"}</p>
            </button>
          ))}
        </CardContent>
      </Card>
      )}
    </AdminLayout>
  );
};

/**
 * Um item de cobertura: o número que falta, sobre quantos, e os primeiros nomes —
 * saber "12 empresas" sem saber quais não ajuda a começar o trabalho.
 */
function Pendencia({
  rotulo,
  total,
  de,
  empresas,
  onClick,
}: {
  rotulo: string;
  total?: number;
  de?: number;
  empresas?: Array<{ id: string; name: string }>;
  onClick?: () => void;
}) {
  const emDia = total === 0;
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border p-3 ${onClick ? "cursor-pointer transition-colors hover:border-primary/40" : ""} ${
        emDia ? "bg-emerald-500/5" : "bg-card"
      }`}
    >
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${emDia ? "text-emerald-600" : ""}`}>
        {total ?? "—"}
        {de !== undefined && total !== undefined && (
          <span className="ml-1 text-sm font-normal text-muted-foreground">de {de}</span>
        )}
      </p>
      {empresas && empresas.length > 0 && (
        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
          {empresas.slice(0, 3).map((e) => e.name).join(" · ")}
          {empresas.length > 3 ? ` e mais ${empresas.length - 3}` : ""}
        </p>
      )}
      {emDia && <p className="mt-1 text-[11px] text-emerald-600">Tudo em dia</p>}
    </div>
  );
}

export default VisaoGeralPage;
