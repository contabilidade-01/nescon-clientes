import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Download, ReceiptText, Search } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, type ClienteSemBoleto } from "@/lib/api";

/** Mês atual no formato do <input type="month"> (YYYY-MM), no fuso local. */
function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function rotuloMes(competencia: string): string {
  const [a, m] = competencia.split("-");
  return `${m}/${a}`;
}

function baixarCsv(competencia: string, linhas: ClienteSemBoleto[]) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const corpo = [
    ["Empresa", "CNPJ", "Matriz", "Boletos no portal", "Cobrança de honorário", "G-Click"].map(esc).join(";"),
    ...linhas.map((c) =>
      [
        c.name,
        c.cnpj,
        c.matriz_nome || "",
        c.boletos_ativo ? "ligado" : "desligado",
        c.honorario_cobranca_ativo ? "ligada" : "desligada",
        c.gclick_status || "",
      ]
        .map(esc)
        .join(";")
    ),
  ].join("\r\n");
  // BOM para o Excel abrir acentos certo.
  const url = URL.createObjectURL(new Blob(["﻿" + corpo], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `clientes-sem-boleto-${competencia}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Marcas que explicam por que o boleto pode não ter aparecido. */
function Marcas({ c }: { c: ClienteSemBoleto }) {
  return (
    <div className="flex flex-wrap gap-1">
      {!c.boletos_ativo && <Badge variant="outline">Boletos desligados no portal</Badge>}
      {!c.honorario_cobranca_ativo && <Badge variant="outline">Cobrança de honorário desligada</Badge>}
      {c.gclick_status && c.gclick_status.toUpperCase() !== "ATIVO" && (
        <Badge variant="secondary">G-Click: {c.gclick_status}</Badge>
      )}
    </div>
  );
}

function Linha({ c }: { c: ClienteSemBoleto }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{c.name}</p>
        <p className="text-xs text-muted-foreground">
          CNPJ {c.cnpj}
          {c.matriz_nome ? ` · filial de ${c.matriz_nome}` : ""}
        </p>
      </div>
      <Marcas c={c} />
    </div>
  );
}

const ClientesSemBoletoPage = () => {
  const [competencia, setCompetencia] = useState(mesAtual);
  const [busca, setBusca] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["clientes-sem-boleto", competencia],
    queryFn: () => api.admin.clientesSemBoleto(competencia),
    enabled: /^\d{4}-\d{2}$/.test(competencia),
  });

  const q = busca.trim().toLowerCase();
  const filtrar = (l: ClienteSemBoleto[] = []) =>
    q ? l.filter((c) => c.name.toLowerCase().includes(q) || c.cnpj.includes(q)) : l;
  const semBoleto = filtrar(data?.sem_boleto);
  const cobertas = filtrar(data?.cobertas_pela_matriz);

  return (
    <AdminLayout
      title="Clientes sem boleto"
      description="Empresas ativas que não têm boleto Cora emitido na competência escolhida"
    >
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Sem boleto</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-destructive">
            {data ? data.sem_boleto.length : "—"}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Com boleto</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{data?.com_boleto ?? "—"}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Empresas ativas</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{data?.total_ativas ?? "—"}</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ReceiptText className="h-4 w-4" /> Sem boleto em {rotuloMes(competencia)}
          </CardTitle>
          <CardDescription>
            A competência do boleto é o mês do <strong>vencimento</strong>. A conferência usa os
            boletos que a sincronização já trouxe da Cora
            {data?.sync_em
              ? ` (última sync em ${new Date(data.sync_em).toLocaleString("pt-BR")})`
              : ""}
            ; boleto emitido depois disso só aparece após sincronizar em{" "}
            <Link to="/admin/boletos-cora" className="underline">
              Boletos Cora
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="month"
              className="w-44"
              value={competencia}
              onChange={(e) => e.target.value && setCompetencia(e.target.value)}
            />
            <div className="relative min-w-[12rem] flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Buscar por razão social ou CNPJ"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!data?.sem_boleto.length}
              onClick={() => data && baixarCsv(data.competencia, data.sem_boleto)}
            >
              <Download className="mr-1 h-4 w-4" /> Exportar CSV
            </Button>
          </div>

          <div className="max-h-[36rem] space-y-2 overflow-y-auto">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : error ? (
              <p className="text-sm text-destructive">{(error as Error).message}</p>
            ) : semBoleto.length ? (
              semBoleto.map((c) => <Linha key={c.id} c={c} />)
            ) : (
              <p className="text-sm text-muted-foreground">
                {q ? "Nenhuma empresa nesse filtro." : "Todas as empresas ativas têm boleto nesta competência."}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {cobertas.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Filiais cobertas pela matriz</CardTitle>
            <CardDescription>
              Sem boleto próprio, mas a matriz teve boleto em {rotuloMes(competencia)}. Normalmente
              o honorário do grupo sai num boleto só; confira se é o caso.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {cobertas.map((c) => (
              <Linha key={c.id} c={c} />
            ))}
          </CardContent>
        </Card>
      )}
    </AdminLayout>
  );
};

export default ClientesSemBoletoPage;
