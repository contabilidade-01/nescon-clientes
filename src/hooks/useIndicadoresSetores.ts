import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { canSeeArea } from "@/lib/adminAreas";
import { useGclickPendencias } from "@/hooks/useGclickPendencias";

export type IndicadorSetor = {
  label: string;
  valor: number | string;
  dica?: string;
  tom?: "success" | "warning" | "destructive";
  to?: string;
};

export type BarraSetor = { partes: Array<{ valor: number; cor: string }>; legenda: string };

/**
 * Números de cada setor do painel, para a tela Geral e a tela do setor. Só consulta o
 * que a pessoa pode ver (a rota responderia 403); indicador sem dado não aparece.
 * Mesmas chaves de cache da Visão geral detalhada: abrir uma depois da outra não refaz.
 */
export function useIndicadoresSetores() {
  const { admin } = useAuth();
  const pode = (a: Parameters<typeof canSeeArea>[0]) => canSeeArea(a, admin?.areas, admin?.isOwner);
  const podeLicencas = pode("licencas");
  const podeAtendimento = pode("atendimento");
  const podeAcompanhamentos = pode("acompanhamentos");
  const { data: pendencias, pode: podeGclick } = useGclickPendencias();

  const { data: summary } = useQuery({ queryKey: ["admin-summary"], queryFn: () => api.admin.summary() });
  const { data: licencas } = useQuery({
    queryKey: ["licencas-overview"],
    queryFn: () => api.licencas.overview(),
    enabled: podeLicencas,
  });
  const { data: certificados } = useQuery({
    queryKey: ["certificados-overview"],
    queryFn: () => api.certificados.overview(),
    enabled: podeLicencas,
  });
  const { data: atendimentos } = useQuery({
    queryKey: ["admin-atendimentos-summary"],
    queryFn: () => api.atendimentos.summary(),
    enabled: podeAtendimento,
    refetchInterval: 60_000,
  });
  const { data: acompMes } = useQuery({
    queryKey: ["acompanhamentos-mes-home"],
    queryFn: () => api.admin.acompanhamentos.mes(),
    enabled: podeAcompanhamentos,
  });

  const indicadores: Record<string, IndicadorSetor[]> = {
    comercial: [],
    "clientes-dp": [],
    entregas: [],
    fiscal: [],
    sistema: [],
  };
  const barras: Record<string, BarraSetor | undefined> = {};

  if (podeGclick && pendencias) {
    indicadores.comercial.push(
      { label: "Clientes novos do G-Click", valor: pendencias.novos_count, tom: pendencias.novos_count ? "destructive" : undefined, to: "/admin/clientes-gclick" },
      { label: "Mudanças de situação", valor: pendencias.mudancas_count, tom: pendencias.mudancas_count ? "warning" : undefined, to: "/admin/clientes-gclick" }
    );
  }

  if (summary) {
    indicadores["clientes-dp"].push(
      { label: "Empresas", valor: summary.companies, to: pode("empresas") ? "/admin/empresas" : undefined },
      { label: "Funcionários", valor: summary.employees, to: pode("funcionarios") ? "/admin/funcionarios" : undefined }
    );
    indicadores.entregas.push(
      { label: "Entregas", valor: summary.deliverables, to: pode("entregas") ? "/admin/entregas" : undefined },
      { label: "Retidas", valor: summary.deliverables_retidas, dica: "aguardando revisão", tom: summary.deliverables_retidas ? "warning" : undefined, to: pode("entregas") ? "/admin/entregas" : undefined }
    );
    const total = summary.deliverables_liberadas + summary.deliverables_retidas;
    barras.entregas = {
      partes: [
        { valor: summary.deliverables_liberadas, cor: "bg-primary" },
        { valor: summary.deliverables_retidas, cor: "bg-warning" },
      ],
      legenda: total ? `${Math.round((summary.deliverables_liberadas / total) * 100)}% liberadas aos clientes` : "Sem entregas ainda",
    };
  }

  if (podeAcompanhamentos && acompMes) {
    const abertas = acompMes.tarefas.filter((t) => t.status !== "concluido").length;
    const atrasadas = acompMes.tarefas.filter((t) => t.status_efetivo === "atrasado").length;
    const concluidas = acompMes.tarefas.length - abertas;
    barras["clientes-dp"] = {
      partes: [
        { valor: concluidas, cor: "bg-success" },
        { valor: abertas - atrasadas, cor: "bg-warning" },
        { valor: atrasadas, cor: "bg-destructive" },
      ],
      legenda: `Acompanhamentos ${acompMes.competencia}: ${abertas} abertos · ${atrasadas} atrasados`,
    };
  }

  if (podeLicencas && licencas) {
    indicadores.fiscal.push(
      { label: "Licenças vencidas", valor: licencas.por_status.vencida, tom: licencas.por_status.vencida ? "destructive" : undefined, to: "/admin/licencas" },
      { label: "Licenças a vencer", valor: licencas.por_status.a_vencer, tom: licencas.por_status.a_vencer ? "warning" : undefined, to: "/admin/licencas" }
    );
  }
  if (podeLicencas && certificados) {
    const p = certificados.por_status;
    indicadores.fiscal.push(
      { label: "Certificados vencidos", valor: p.vencido, tom: p.vencido ? "destructive" : undefined, to: "/admin/certificados" },
      { label: `Certificados a vencer (${certificados.dias_aviso} d)`, valor: p.a_vencer, tom: p.a_vencer ? "warning" : undefined, to: "/admin/certificados" }
    );
  }

  if (podeAtendimento && atendimentos) {
    indicadores.sistema.push(
      { label: "Conversas na fila", valor: atendimentos.na_fila, tom: atendimentos.na_fila ? "destructive" : undefined, to: "/admin/atendimentos" },
      { label: "Em atendimento", valor: atendimentos.em_atendimento, to: "/admin/atendimentos" }
    );
  }

  return { indicadores, barras, pendencias: podeGclick ? pendencias : undefined };
}
