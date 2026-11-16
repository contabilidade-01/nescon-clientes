import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { CalendarRange, Megaphone, Search } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminCompanies } from "@/hooks/useAdminCompanies";
import { api } from "@/lib/api";
import { ETAPA_40H, ETAPA_42H, dataBR, hojeISO, situacaoJornada } from "@/lib/jornadaFuncionario";

type Empresa = Awaited<ReturnType<typeof api.escalas.prontidao>>[number];

/** Texto pronto da circular para os clientes (o escritório revisa antes de enviar). */
export const TEXTO_CIRCULAR_JORNADA = `Olá! Aqui é a Nescon.

A Emenda Constitucional 141/2026 reduz a jornada de trabalho:
• a partir de ${dataBR(ETAPA_42H.inicio)}: limite de 42 horas por semana e 2 folgas semanais (fim da escala 6x1);
• a partir de ${dataBR(ETAPA_40H.inicio)}: limite de 40 horas por semana.
O salário dos funcionários não pode ser reduzido.

O que fazer agora:
1. Entre no portal, em Funcionários, e confira a lista: quem entrou, quem saiu e a jornada de cada um.
2. Em Escalas de trabalho, monte a escala de dezembro. O sistema avisa o que fica fora da regra.
3. Quem mudar de jornada assina um aditivo ao contrato, que o portal gera.

Qualquer dúvida, fale com o Departamento Pessoal da Nescon.`;

function contar(e: Empresa, data: string) {
  let fora = 0;
  let atencao = 0;
  let semDado = 0;
  for (const f of e.funcionarios) {
    const s = situacaoJornada(f, data);
    if (s.nivel === "fora") fora++;
    else if (s.nivel === "atencao") atencao++;
    else if (s.nivel === "sem_dado") semDado++;
  }
  return { fora, atencao, semDado };
}

/**
 * Prontidão da carteira para a redução de jornada: para cada cliente com funcionário,
 * quantos ficam fora da regra em cada etapa, se a lista foi conferida e se a escala de
 * dezembro está pronta. Liberar o planejador para o cliente é feito aqui, em lote.
 */
const JornadasProntidaoPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hoje = hojeISO();
  const [busca, setBusca] = useState("");
  const [soPendentes, setSoPendentes] = useState(true);
  const [etapa, setEtapa] = useState<"42" | "40">(hoje < ETAPA_42H.inicio ? "42" : "40");
  const dataEtapa = etapa === "42" ? ETAPA_42H.inicio : ETAPA_40H.inicio;
  const mesEtapa = dataEtapa.slice(0, 7);

  const { data, isLoading } = useQuery({ queryKey: ["jornadas-prontidao"], queryFn: () => api.escalas.prontidao() });
  const { data: companies } = useAdminCompanies();

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (data || [])
      .map((e) => ({ e, c: contar(e, dataEtapa), escalaPronta: e.meses.includes(mesEtapa) }))
      .filter(({ e }) => !q || e.name.toLowerCase().includes(q) || e.cnpj.includes(q.replace(/\D/g, "") || "§"))
      .filter(({ c, e, escalaPronta }) => !soPendentes || c.fora > 0 || c.semDado > 0 || !escalaPronta || !e.conferido_em)
      .sort((a, b) => b.c.fora - a.c.fora || b.c.semDado - a.c.semDado || a.e.name.localeCompare(b.e.name));
  }, [data, busca, soPendentes, dataEtapa, mesEtapa]);

  const totais = useMemo(() => {
    const t = { empresas: 0, funcionarios: 0, fora: 0, semDado: 0, conferidas: 0, escalaPronta: 0 };
    for (const e of data || []) {
      const c = contar(e, dataEtapa);
      t.empresas++;
      t.funcionarios += e.funcionarios.length;
      t.fora += c.fora;
      t.semDado += c.semDado;
      if (e.conferido_em) t.conferidas++;
      if (e.meses.includes(mesEtapa)) t.escalaPronta++;
    }
    return t;
  }, [data, dataEtapa, mesEtapa]);

  const liberar = useMutation({
    mutationFn: async (ids: string[]) => {
      let ok = 0;
      for (const id of ids) {
        const c = companies?.find((x) => x.id === id);
        if (!c) continue;
        await api.admin.updateCompany(id, { tool_access: { ...c.tool_access, escalas: true } });
        ok++;
      }
      return ok;
    },
    onSuccess: (n) => {
      queryClient.invalidateQueries({ queryKey: ["jornadas-prontidao"] });
      queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
      toast.success(`Escalas de trabalho liberadas para ${n} empresa(s)`);
    },
    onError: (e: Error) => toast.error(e.message || "Erro ao liberar"),
  });

  const naoLiberadas = linhas.filter(({ e }) => !e.escalas_liberado).map(({ e }) => e.id);

  return (
    <AdminLayout
      largo
      title="Prontidão 42h / 40h"
      description="Quais clientes já se adaptaram à redução de jornada (EC 141/2026) e quais ainda precisam agir"
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Empresas com funcionário", totais.empresas],
            ["Funcionários ativos", totais.funcionarios],
            [`Fora da regra em ${dataBR(dataEtapa)}`, totais.fora],
            ["Sem jornada no cadastro", totais.semDado],
            ["Listas conferidas", totais.conferidas],
            [`Escala de ${mesEtapa.split("-").reverse().join("/")} salva`, totais.escalaPronta],
          ].map(([rot, n]) => (
            <Card key={rot as string}>
              <CardContent className="p-3">
                <p className="text-2xl font-semibold tabular-nums">{n}</p>
                <p className="text-xs text-muted-foreground">{rot}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Buscar empresa ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <div className="flex rounded-md border p-0.5 text-xs">
            {(["42", "40"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setEtapa(k)}
                className={`rounded px-2 py-1 ${etapa === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                Etapa {k}h ({dataBR(k === "42" ? ETAPA_42H.inicio : ETAPA_40H.inicio)})
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} />
            Só com pendência
          </label>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!naoLiberadas.length || liberar.isPending || !companies}
              onClick={() => liberar.mutate(naoLiberadas)}
            >
              <CalendarRange className="mr-1 h-4 w-4" /> Liberar escalas para {naoLiberadas.length} da lista
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate("/admin/circular", { state: { texto: TEXTO_CIRCULAR_JORNADA } })}>
              <Megaphone className="mr-1 h-4 w-4" /> Circular aos clientes
            </Button>
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : !linhas.length ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">Nenhuma empresa com pendência neste filtro.</CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Empresa</th>
                  <th className="px-3 py-2 font-medium">Funcionários</th>
                  <th className="px-3 py-2 font-medium">Fora da regra</th>
                  <th className="px-3 py-2 font-medium">Atenção</th>
                  <th className="px-3 py-2 font-medium">Sem jornada</th>
                  <th className="px-3 py-2 font-medium">Planejador</th>
                  <th className="px-3 py-2 font-medium">Escala salva</th>
                  <th className="px-3 py-2 font-medium">Lista conferida</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(({ e, c, escalaPronta }) => (
                  <tr key={e.id} className="border-t">
                    <td className="px-3 py-2">
                      <Link to={`/admin/escalas?empresa=${e.id}`} className="font-medium hover:underline">
                        {e.name}
                      </Link>
                      <div className="text-[11px] text-muted-foreground">
                        {e.cnpj}
                        {e.escala_12x36 ? " · 12x36" : ""}
                        {e.tem_acordo ? " · com acordo" : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{e.funcionarios.length}</td>
                    <td className={`px-3 py-2 tabular-nums ${c.fora ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{c.fora}</td>
                    <td className={`px-3 py-2 tabular-nums ${c.atencao ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{c.atencao}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{c.semDado}</td>
                    <td className="px-3 py-2 text-xs">
                      {e.escalas_liberado ? "Liberado" : <span className="text-muted-foreground">Desligado</span>}
                      {e.atividade_definida ? "" : <div className="text-[11px] text-muted-foreground">atividade não definida</div>}
                    </td>
                    <td className="px-3 py-2 text-xs">{escalaPronta ? "Sim" : <span className="text-muted-foreground">Não</span>}</td>
                    <td className="px-3 py-2 text-xs">
                      {e.conferido_em ? new Date(e.conferido_em).toLocaleDateString("pt-BR") : <span className="text-muted-foreground">Nunca</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          "Fora da regra" usa a jornada do cadastro de cada funcionário na data da etapa. Quem está sem jornada não entra na
          conta: peça ao cliente para conferir a lista em Funcionários.
        </p>
      </div>
    </AdminLayout>
  );
};

export default JornadasProntidaoPage;
