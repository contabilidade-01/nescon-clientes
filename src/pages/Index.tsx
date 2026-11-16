import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  FileBadge,
  FileX,
  KeyRound,
  LogOut,
  Palmtree,
  Receipt,
  Sparkles,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { situacaoPagamentos } from "@/lib/situacaoPagamentos";
import { isToolAllowed, mergeClientToolAccess, type CompanyToolKey } from "@/lib/companyTools";
import { formatDueLong } from "@/lib/deliverableDisplay";
import { LgpdConsentDialog } from "@/components/LgpdConsentDialog";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { Atalho, HubCard, IconBox, Indicador, RoscaPagamentos } from "@/components/hub/Hub";
import {
  ATALHOS_INICIO,
  ITEM_CHAT,
  itensPorChaves,
  setoresVisiveisPortal,
  type PortalItem,
} from "@/lib/portalNav";

const Index = () => {
  const navigate = useNavigate();
  const { company, logout, login } = useAuth();

  // Registra a abertura de uma ferramenta (tela "Controle de acessos") e navega.
  // Best-effort: se o registro falhar, a navegação acontece do mesmo jeito.
  const abrirFerramenta = (tool: CompanyToolKey | undefined, path: string) => {
    if (tool) api.portal.registrarUso(tool);
    navigate(path);
  };
  const abrirItem = (item: PortalItem) => abrirFerramenta(item.tool, item.path);
  // Aviso de LGPD: só abre se o servidor disser que a empresa nunca respondeu.
  const [mostrarLgpd, setMostrarLgpd] = useState(false);

  useEffect(() => {
    if (!company?.id || !company.token) return;
    const { id, token, mustChangePassword, isAdminPersonified, isMatriz, empresasGrupo, escala12x36, gerente } = company;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.auth.companySession();
        if (cancelled) return;
        // Personificação: não mostrar o aviso de LGPD — o aceite é do cliente, não do
        // admin que está só conferindo o ambiente.
        // Gerente também não: o aceite é da empresa.
        setMostrarLgpd(!isAdminPersonified && !gerente && !data.lgpd?.consent_at && !data.lgpd?.prompt_seen_at);
        login({
          role: "company",
          id,
          name: data.company.name,
          cnpj: data.company.cnpj,
          token,
          toolAccess: mergeClientToolAccess(data.tool_access),
          // Preserva a marca: este refresh é só de nome/permissões.
          mustChangePassword,
          temFuncionarios: data.tem_funcionarios !== false,
          // Só troca a escala se o servidor mandou true/false. Campo ausente (API antiga
          // ou falha) não pode zerar a flag — senão a tela volta a contar dia corrido.
          escala12x36: typeof data.escala_12x36 === "boolean" ? data.escala_12x36 : Boolean(escala12x36),
          // Preserva o estado da sessão (senão o refresh apagava a personificação e o grupo).
          isAdminPersonified,
          isMatriz,
          empresasGrupo,
          gerente: data.gerente ?? gerente ?? null,
        });
      } catch {
        /* sessão inválida ou rede: mantém estado local */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [company?.id, company?.token, company?.mustChangePassword, login]);

  const canSeePayments = isToolAllowed(company?.toolAccess, "calendar");
  // Gerente só emite advertência/suspensão: o servidor recusa o resto, então nem pede.
  const isGerente = Boolean(company?.gerente);

  const { data: upcoming, isLoading: loadingUpcoming } = useQuery({
    queryKey: ["deliverables-upcoming", "home"],
    queryFn: () => api.deliverables.upcoming({ limit: 3 }),
    enabled: !!company && canSeePayments,
  });

  // Férias urgentes na porta de entrada: sem isto o cliente precisa descobrir o menu
  // sozinho para saber que alguém está prestes a perder dias.
  const podeFerias =
    isToolAllowed(company?.toolAccess, "vacations") && company?.temFuncionarios !== false;
  const { data: ferias } = useQuery({
    queryKey: ["ferias", "home"],
    queryFn: () => api.ferias.listar(),
    enabled: !!company && podeFerias,
  });

  // Todas as entregas: alimenta a rosca de pagamentos.
  const { data: entregas, isLoading: loadingEntregas } = useQuery({
    queryKey: ["deliverables", "home-count"],
    queryFn: () => api.deliverables.list(),
    enabled: !!company && !isGerente,
  });

  const podeFuncionarios = isToolAllowed(company?.toolAccess, "employees") && !isGerente;
  const { data: funcionarios } = useQuery({
    queryKey: ["employees", "home"],
    queryFn: () => api.employees.list(),
    enabled: !!company && podeFuncionarios,
  });

  // Mensagens sem resposta do escritório. Sem este número, o cliente só descobre que
  // foi respondido se abrir a tela por conta própria.
  const podeChat = isToolAllowed(company?.toolAccess, "chat");
  const { data: chatUnread } = useQuery({
    queryKey: ["chat-unread"],
    queryFn: () => api.chat.unread(),
    enabled: !!company && podeChat,
    refetchInterval: 60_000,
  });
  const naoLidasChat = chatUnread?.count ?? 0;

  // Primeiros passos do cliente novo: enquanto houver onboarding em aberto, aparece na porta de
  // entrada, com o que falta enviar. Concluído some.
  const { data: onboarding } = useQuery({
    queryKey: ["onboarding-portal"],
    queryFn: () => api.onboarding.portal(),
    enabled: !!company && !isGerente,
    retry: false,
  });
  const passos = onboarding?.onboarding && onboarding.onboarding.status !== "concluido" ? onboarding.onboarding : null;

  // Certificado digital: só avisa na entrada quando vence logo ou já venceu.
  const { data: certificado } = useQuery({
    queryKey: ["certificado-digital"],
    queryFn: () => api.certificadoDigital.meu(),
    enabled: !!company && !isGerente,
    retry: false,
  });

  const setores = setoresVisiveisPortal(company);
  const atalhos = itensPorChaves(ATALHOS_INICIO, company, 4);
  const pagamentos = useMemo(() => situacaoPagamentos(entregas), [entregas]);
  const totalPagamentos = pagamentos.pagas + pagamentos.aVencer + pagamentos.vencidas;

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const abertas = upcoming?.length ?? 0;
  const proxima = upcoming?.[0];
  const estaPersonificando = Boolean(localStorage.getItem("admin_session_backup"));

  const voltarAoAdmin = () => {
    const backup = localStorage.getItem("admin_session_backup");
    if (backup) {
      localStorage.setItem("company_session", backup);
      localStorage.removeItem("admin_session_backup");
      window.location.href = "/admin/hub";
    }
  };

  const certStatus = certificado?.status;
  const certDias = certificado?.certificado?.dias_restantes ?? null;

  return (
    <div className="min-h-screen">
      <LgpdConsentDialog aberto={mostrarLgpd} onResolvido={() => setMostrarLgpd(false)} />

      {/* Banner de personificação — admin está vendo como cliente */}
      {estaPersonificando && (
        <div className="sticky top-0 z-50 flex items-center justify-between gap-2 bg-amber-600 px-4 py-2 text-white text-sm">
          <span>👁️ Você está vendo o portal como <strong>{company?.name}</strong></span>
          <button
            onClick={voltarAoAdmin}
            className="rounded bg-white/20 px-3 py-1 text-xs font-medium hover:bg-white/30 transition-colors"
          >
            ← Voltar ao admin
          </button>
        </div>
      )}

      <header className="border-b border-border/60 bg-card/40 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-dashed border-primary/40 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted-foreground">Seja bem-vindo</p>
            <h1 className="truncate text-sm font-bold leading-tight sm:text-base">
              {isGerente ? company?.gerente?.nome : company?.name ?? "Portal do Cliente"}
            </h1>
          </div>
          <CompanySwitcher />
          {!isGerente && (
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => navigate("/gerentes")}
              aria-label="Gerentes"
              title="Gerentes: acessos só para advertência e suspensão"
            >
              <UserCog className="h-5 w-5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/alterar-senha")}
            aria-label="Alterar senha"
          >
            <KeyRound className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive/80 hover:text-destructive"
            onClick={handleLogout}
            aria-label="Sair"
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5 sm:space-y-6">
        {/* Primeiros passos do cliente novo */}
        {passos && (
          <section aria-label="Primeiros passos" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Seus primeiros passos na Nescon</p>
              <p className="text-xs text-muted-foreground">
                {passos.progresso.enviados} de {passos.progresso.total} documentos enviados. Veja o que falta e até quando.
              </p>
            </div>
            <Button size="sm" onClick={() => navigate("/primeiros-passos")}>
              Ver o que falta
            </Button>
          </section>
        )}

        {/* Gerente: só advertência e suspensão, em destaque. */}
        {isGerente && (
          <section className="grid gap-3 sm:grid-cols-2">
            {isToolAllowed(company?.toolAccess, "warning") && (
              <button
                type="button"
                onClick={() => abrirFerramenta("warning", "/advertencia")}
                className="group flex items-center gap-4 rounded-2xl border bg-card p-5 text-left transition-colors hover:border-primary/50"
              >
                <IconBox icon={AlertTriangle} className="h-12 w-12" />
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold">Gerar Advertência</h3>
                  <p className="text-sm text-muted-foreground">Emitir advertência formal ao funcionário</p>
                </div>
                <ArrowUpRight className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-primary" />
              </button>
            )}
            {isToolAllowed(company?.toolAccess, "suspension") && (
              <button
                type="button"
                onClick={() => abrirFerramenta("suspension", "/suspensao")}
                className="group flex items-center gap-4 rounded-2xl border bg-card p-5 text-left transition-colors hover:border-destructive/50"
              >
                <IconBox icon={FileX} tom="destructive" className="h-12 w-12" />
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold">Gerar Suspensão</h3>
                  <p className="text-sm text-muted-foreground">Emitir suspensão formal ao funcionário</p>
                </div>
                <ArrowUpRight className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-destructive" />
              </button>
            )}
          </section>
        )}

        {!isGerente && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            {/* Cartão principal: o que vence agora */}
            {canSeePayments ? (
              <HubCard
                icon={Receipt}
                titulo="Próximo vencimento"
                className="card-glow"
                acao={
                  <button
                    type="button"
                    onClick={() => abrirFerramenta("calendar", "/proximos-pagamentos")}
                    className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Ver todos <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                }
              >
                {loadingUpcoming ? (
                  <Skeleton className="mt-4 h-14 rounded-xl" />
                ) : proxima ? (
                  <button
                    type="button"
                    onClick={() => abrirFerramenta("calendar", "/proximos-pagamentos")}
                    className="mt-3 block w-full text-left"
                  >
                    <p className="text-2xl font-bold tabular-nums sm:text-3xl">{formatDueLong(proxima.due_date)}</p>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {proxima.title}
                      {" · "}
                      {abertas} {abertas === 1 ? "pagamento próximo" : "pagamentos próximos"}
                    </p>
                  </button>
                ) : (
                  <div className="mt-3 flex items-center gap-3">
                    <CheckCircle2 className="h-6 w-6 shrink-0 text-success" />
                    <div>
                      <p className="font-semibold">Nenhuma guia em aberto</p>
                      <p className="text-xs text-muted-foreground">
                        Novos vencimentos aparecem aqui assim que a contabilidade enviar.
                      </p>
                    </div>
                  </div>
                )}
              </HubCard>
            ) : (
              <HubCard icon={Sparkles} titulo="Portal do cliente">
                <p className="mt-3 text-sm text-muted-foreground">Seus documentos ficam guardados aqui.</p>
              </HubCard>
            )}

            {/* Atalhos do que o cliente mais usa */}
            {atalhos.length > 0 && (
              <section aria-label="Atalhos" className="grid grid-cols-4 content-center gap-2 rounded-2xl md:border md:bg-card md:p-4">
                {atalhos.map((a) => (
                  <Atalho key={a.key} icon={a.icon} label={a.title} onClick={() => abrirItem(a)} />
                ))}
              </section>
            )}
          </div>
        )}

        {/* Avisos: só quando há o que resolver — cartão vazio vira ruído. */}
        {!isGerente && (certStatus === "vencido" || certStatus === "a_vencer") && (
          <button
            type="button"
            onClick={() => navigate("/certificado-digital")}
            className={`flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left ${
              certStatus === "vencido" ? "border-destructive/50 bg-destructive/10" : "border-warning/50 bg-warning/10"
            }`}
          >
            <IconBox icon={FileBadge} tom={certStatus === "vencido" ? "destructive" : "warning"} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">
                {certStatus === "vencido"
                  ? "Seu certificado digital venceu"
                  : certDias === 0
                    ? "Seu certificado digital vence hoje"
                    : `Seu certificado digital vence em ${certDias} dia${certDias === 1 ? "" : "s"}`}
              </span>
              <span className="block text-xs text-muted-foreground">
                Sem ele não emitimos notas nem entregamos declarações. Toque para ver e informar a renovação.
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </button>
        )}

        {podeFerias && ferias?.resumo && (ferias.resumo.vencidas > 0 || ferias.resumo.em_risco_faltas > 0) && (
          <button
            type="button"
            onClick={() => abrirFerramenta("vacations", "/ferias")}
            className="flex w-full items-center gap-3 rounded-2xl border-2 border-warning/50 bg-warning/10 px-4 py-3 text-left"
          >
            <IconBox icon={Palmtree} tom="warning" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">
                {ferias.resumo.vencidas > 0
                  ? `${ferias.resumo.vencidas} férias vencida(s)`
                  : `${ferias.resumo.em_risco_faltas} funcionário(s) prestes a perder dias de férias`}
              </span>
              <span className="block text-xs text-muted-foreground">
                {ferias.resumo.vencidas > 0 && ferias.resumo.em_risco_faltas > 0
                  ? `E ${ferias.resumo.em_risco_faltas} prestes a perder dias por faltas. `
                  : ""}
                Toque para ver quem, quando e quanto custa.
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          </button>
        )}

        {!isGerente && (podeFuncionarios || podeFerias || canSeePayments) && (
          <div className="grid gap-4 md:grid-cols-2">
            {(podeFuncionarios || podeFerias) && (
              <HubCard
                icon={Users}
                titulo="Departamento Pessoal"
                acao={
                  <button type="button" onClick={() => navigate("/setor/dp")} className="text-xs font-medium text-primary hover:underline">
                    Abrir setor
                  </button>
                }
              >
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {podeFuncionarios && (
                    <Indicador
                      label="Funcionários ativos"
                      valor={funcionarios ? funcionarios.length : "—"}
                      onClick={() => abrirFerramenta("employees", "/funcionarios")}
                    />
                  )}
                  {podeFerias && (
                    <Indicador
                      label="Férias a vencer"
                      valor={ferias?.resumo ? ferias.resumo.a_vencer + ferias.resumo.vencidas : "—"}
                      tom={ferias?.resumo?.vencidas ? "destructive" : ferias?.resumo?.a_vencer ? "warning" : undefined}
                      onClick={() => abrirFerramenta("vacations", "/ferias")}
                    />
                  )}
                </div>
              </HubCard>
            )}

            {canSeePayments && (
              <HubCard icon={Wallet} titulo="Situação dos pagamentos">
                <p className="mt-1 text-xs text-muted-foreground">Guias e boletos dos últimos 90 dias e os próximos</p>
                {loadingEntregas ? (
                  <Skeleton className="mt-3 h-24 rounded-xl" />
                ) : totalPagamentos === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">Nenhuma guia ou boleto no período.</p>
                ) : (
                  <RoscaPagamentos {...pagamentos} />
                )}
              </HubCard>
            )}
          </div>
        )}

        {setores.length === 0 && !(podeChat && !isGerente) && (
          <p className="rounded-2xl border border-dashed bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhuma ferramenta está liberada para esta empresa. Contacte o administrador.
          </p>
        )}

        {/* Setores: no computador é a navegação principal; no celular, a barra inferior repete. */}
        {setores.length > 0 && (
          <section aria-label="Setores">
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Setores</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {setores.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => navigate(`/setor/${s.id}`)}
                  className="group flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary/50"
                >
                  <span className="flex items-center gap-3">
                    <IconBox icon={s.icon} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{s.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{s.descricao}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {s.items.slice(0, 4).map((i) => (
                      <span key={i.key} className="rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {i.title}
                      </span>
                    ))}
                    {s.items.length > 4 && (
                      <span className="rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground">
                        +{s.items.length - 4}
                      </span>
                    )}
                  </span>
                </button>
              ))}
              {podeChat && !isGerente && (
                <button
                  type="button"
                  onClick={() => abrirItem(ITEM_CHAT)}
                  className="group flex min-w-0 items-center gap-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary/50"
                >
                  <IconBox icon={ITEM_CHAT.icon} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      Mensagens
                      {naoLidasChat > 0 && (
                        <span className="rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                          {naoLidasChat}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">Fale com o escritório</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                </button>
              )}
            </div>
          </section>
        )}

        {!isGerente && canSeePayments && (
          <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" /> Vencimentos atualizados quando a contabilidade envia as guias.
          </p>
        )}
      </main>
    </div>
  );
};

export default Index;
