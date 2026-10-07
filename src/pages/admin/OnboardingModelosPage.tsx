import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AgenteOnboarding } from "@/components/onboarding/AgenteOnboarding";
import { CartaoSecao, EditorRegras, ListaBlocos } from "@/components/onboarding/ConstrutorModelo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { comUids, resumoRegras, semUids, type ModeloEntrada, type OnboardingModelo } from "@/lib/onboardingModelo";

const NOVO: ModeloEntrada = { nome: "", descricao: "", regras: {}, blocos: [], ativo: true };

function Editor({ inicial, id, onVoltar }: { inicial: ModeloEntrada; id: string | null; onVoltar: () => void }) {
  const queryClient = useQueryClient();
  const [modelo, setModelo] = useState<ModeloEntrada>({ ...inicial, blocos: comUids(inicial.blocos) });
  const set = (p: Partial<ModeloEntrada>) => setModelo((m) => ({ ...m, ...p }));

  const salvar = useMutation({
    mutationFn: () => api.admin.onboarding.salvarModelo(id, { ...modelo, blocos: semUids(modelo.blocos) }),
    onSuccess: () => {
      toast.success("Modelo salvo.");
      queryClient.invalidateQueries({ queryKey: ["admin-onboarding", "modelos"] });
      onVoltar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onVoltar}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Modelos
        </Button>
        <Button disabled={!modelo.nome.trim() || salvar.isPending} onClick={() => salvar.mutate()}>
          {salvar.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          Salvar modelo
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <CartaoSecao titulo="Identificação">
            <div className="space-y-1">
              <Label htmlFor="modelo-nome">Nome</Label>
              <Input id="modelo-nome" value={modelo.nome} maxLength={120} onChange={(e) => set({ nome: e.target.value })} placeholder="Ex.: Simples Nacional — com funcionários" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="modelo-desc">Descrição</Label>
              <Textarea id="modelo-desc" rows={2} value={modelo.descricao} maxLength={500} onChange={(e) => set({ descricao: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={modelo.ativo !== false} onChange={(e) => set({ ativo: e.target.checked })} />
              Ativo (pode ser escolhido para contratos novos)
            </label>
          </CartaoSecao>

          <CartaoSecao titulo="Para quais contratos este modelo serve">
            <p className="text-xs text-muted-foreground">Sem nenhuma marca, serve para qualquer contrato. Entre vários modelos que servem, vale o que tem mais critérios.</p>
            <EditorRegras regras={modelo.regras} onChange={(regras) => set({ regras })} />
          </CartaoSecao>

          <CartaoSecao titulo={`Roteiro do cliente (${modelo.blocos.length} ${modelo.blocos.length === 1 ? "bloco" : "blocos"})`}>
            <ListaBlocos blocos={modelo.blocos} onChange={(blocos) => set({ blocos })} />
          </CartaoSecao>
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <AgenteOnboarding
            modelo={{ ...modelo, blocos: semUids(modelo.blocos) }}
            onAplicar={(m) => setModelo({ ...m, blocos: comUids(m.blocos) })}
          />
        </div>
      </div>
    </div>
  );
}

export default function OnboardingModelosPage() {
  const queryClient = useQueryClient();
  const modelos = useQuery({ queryKey: ["admin-onboarding", "modelos"], queryFn: () => api.admin.onboarding.modelos() });
  const [editando, setEditando] = useState<{ id: string | null; modelo: ModeloEntrada } | null>(null);

  const excluir = useMutation({
    mutationFn: (id: string) => api.admin.onboarding.excluirModelo(id),
    onSuccess: () => {
      toast.success("Modelo excluído.");
      queryClient.invalidateQueries({ queryKey: ["admin-onboarding", "modelos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const abrir = (m: OnboardingModelo) =>
    setEditando({ id: m.id, modelo: { nome: m.nome, descricao: m.descricao, regras: m.regras || {}, blocos: m.blocos || [], ativo: m.ativo } });

  return (
    <AdminLayout title="Modelos de onboarding">
      {editando ? (
        <Editor key={editando.id ?? "novo"} inicial={editando.modelo} id={editando.id} onVoltar={() => setEditando(null)} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/onboarding">
                <ArrowLeft className="mr-1 h-4 w-4" /> Onboarding
              </Link>
            </Button>
            <Button onClick={() => setEditando({ id: null, modelo: NOVO })}>
              <Plus className="mr-1 h-4 w-4" /> Novo modelo
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            O modelo é o roteiro que o cliente novo recebe: o que enviar, até quando e por onde. Monte arrastando blocos ou conversando com o agente de IA.
          </p>
          {modelos.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
          <div className="grid gap-3 md:grid-cols-2">
            {(modelos.data || []).map((m) => (
              <Card key={m.id}>
                <CardContent className="flex items-start justify-between gap-3 p-4">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => abrir(m)}>
                    <p className="truncate font-medium">{m.nome}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{resumoRegras(m.regras)}</p>
                    <div className="mt-2 flex gap-1.5">
                      <Badge variant="secondary">{(m.blocos || []).length} blocos</Badge>
                      {!m.ativo && <Badge variant="outline">Inativo</Badge>}
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Excluir modelo ${m.nome}`}
                    onClick={() => {
                      if (window.confirm(`Excluir o modelo "${m.nome}"? Onboardings já criados não mudam.`)) excluir.mutate(m.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
