/**
 * Perfis de honorário: predefinições por situação (ex.: "Comércio · Simples · média").
 * Cada perfil guarda só o que difere dos padrões do escritório; ao aplicá-lo num contrato,
 * esses campos entram e o resto continua como está. O perfil é sugerido pelos critérios
 * (enquadramento, tipo, complexidade) quando a empresa é escolhida.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Campo, SecaoHonorarios, SecaoPrazosVigencia, SecaoRegras, type SetSecao } from "@/components/contratos/FormularioContrato";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { SECOES_PRESET, diffParcial, type ContratoPreset, type PresetCriterios } from "@/lib/contratoCampos";
import {
  COMPLEXIDADE_LABEL,
  ENQUADRAMENTO_LABEL,
  TIPO_LABEL,
  brl,
  dadosPadrao,
  mesclarDados,
  type Complexidade,
  type ContratoDados,
  type Enquadramento,
  type TipoEmpresa,
} from "@/lib/contratoModelo";

export function usePresets() {
  return useQuery({ queryKey: ["admin-contratos", "presets"], queryFn: () => api.admin.contratos.presets() });
}

const QUALQUER = "__qualquer";

function resumoCriterios(c: PresetCriterios): string {
  const partes = [
    c.enquadramento ? ENQUADRAMENTO_LABEL[c.enquadramento as Enquadramento] : "",
    c.tipoEmpresa ? TIPO_LABEL[c.tipoEmpresa as TipoEmpresa] : "",
    c.complexidade ? `complexidade ${COMPLEXIDADE_LABEL[c.complexidade as Complexidade].toLowerCase()}` : "",
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : "sem critério (só aplicação manual)";
}

type Rascunho = { id: string | null; nome: string; descricao: string; criterios: PresetCriterios; ativo: boolean; ordem: number };

export function AbaPerfis() {
  const queryClient = useQueryClient();
  const presets = usePresets();
  const padroes = useQuery({ queryKey: ["admin-contratos", "padroes"], queryFn: () => api.admin.contratos.padroes() });
  const base = useMemo(() => mesclarDados(dadosPadrao(), padroes.data?.padroes), [padroes.data]);

  const [sel, setSel] = useState<Rascunho | null>(null);
  const [dados, setDados] = useState<ContratoDados>(() => dadosPadrao());
  const set: SetSecao = (sec, patch) => setDados((d) => ({ ...d, [sec]: { ...d[sec], ...patch } }));

  function abrir(p: ContratoPreset) {
    setSel({ id: p.id, nome: p.nome, descricao: p.descricao, criterios: p.criterios || {}, ativo: p.ativo, ordem: p.ordem });
    setDados(mesclarDados(base, p.dados));
  }

  function novo(copiaDe?: ContratoPreset) {
    setSel({
      id: null,
      nome: copiaDe ? `${copiaDe.nome} (cópia)` : "",
      descricao: copiaDe?.descricao || "",
      criterios: copiaDe?.criterios || {},
      ativo: true,
      ordem: (presets.data?.length || 0) + 1,
    });
    setDados(mesclarDados(base, copiaDe?.dados));
  }

  // Padrões chegam depois: reabre o perfil aberto sobre a base atualizada.
  useEffect(() => {
    if (sel?.id && presets.data) {
      const p = presets.data.find((x) => x.id === sel.id);
      if (p) setDados(mesclarDados(base, p.dados));
    }
    // só quando a base muda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const salvar = useMutation({
    mutationFn: () => {
      if (!sel) throw new Error("Nenhum perfil aberto");
      if (!sel.nome.trim()) throw new Error("Dê um nome ao perfil");
      // A classificação do perfil entra nos dados: aplicar o perfil também ajusta enquadramento/tipo/complexidade.
      const final: ContratoDados = { ...dados, objeto: { ...dados.objeto } };
      if (sel.criterios.enquadramento) final.objeto.enquadramento = sel.criterios.enquadramento as Enquadramento;
      if (sel.criterios.tipoEmpresa) final.objeto.tipoEmpresa = sel.criterios.tipoEmpresa as TipoEmpresa;
      if (sel.criterios.complexidade) final.objeto.complexidade = sel.criterios.complexidade as Complexidade;
      const corpo = {
        nome: sel.nome.trim(),
        descricao: sel.descricao.trim(),
        criterios: sel.criterios,
        ativo: sel.ativo,
        ordem: sel.ordem,
        dados: diffParcial(base, final, SECOES_PRESET),
      };
      return sel.id ? api.admin.contratos.atualizarPreset(sel.id, corpo) : api.admin.contratos.criarPreset(corpo);
    },
    onSuccess: (p) => {
      toast.success("Perfil salvo.");
      queryClient.invalidateQueries({ queryKey: ["admin-contratos", "presets"] });
      setSel((s) => (s ? { ...s, id: p.id } : s));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const excluir = useMutation({
    mutationFn: (id: string) => api.admin.contratos.excluirPreset(id),
    onSuccess: () => {
      toast.success("Perfil excluído.");
      setSel(null);
      queryClient.invalidateQueries({ queryKey: ["admin-contratos", "presets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const critSel = (campo: keyof PresetCriterios, valor: string) =>
    setSel((s) => (s ? { ...s, criterios: { ...s.criterios, [campo]: valor === QUALQUER ? "" : valor } } : s));

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <Card className="self-start">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Perfis de honorário</CardTitle>
          <CardDescription>
            Predefinições de valor e regras por situação. Ao escolher a empresa, o perfil que bate com enquadramento, tipo e complexidade é sugerido.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button size="sm" onClick={() => novo()}>
            <Plus className="h-4 w-4 mr-1" /> Novo perfil
          </Button>
          <div className="max-h-[70vh] overflow-auto divide-y rounded-md border">
            {(presets.data || []).map((p) => (
              <button key={p.id} type="button" onClick={() => abrir(p)} className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${p.id === sel?.id ? "bg-muted" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{p.nome}</span>
                  {!p.ativo ? <Badge variant="secondary">inativo</Badge> : p.dados.honorarios?.valorMensal ? <Badge variant="secondary">{brl(p.dados.honorarios.valorMensal)}</Badge> : null}
                </div>
                <div className="text-xs text-muted-foreground">{resumoCriterios(p.criterios || {})}</div>
              </button>
            ))}
            {!presets.data?.length ? <div className="px-3 py-6 text-sm text-muted-foreground text-center">{presets.isLoading ? "Carregando…" : "Nenhum perfil ainda."}</div> : null}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {!sel ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">Escolha um perfil à esquerda ou crie um novo.</CardContent>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex-1" />
              {sel.id ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => novo(presets.data?.find((p) => p.id === sel.id))}>
                    <Copy className="h-4 w-4 mr-1" /> Duplicar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (window.confirm(`Excluir o perfil "${sel.nome}"? Contratos já criados não mudam.`)) excluir.mutate(sel.id as string);
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-1 text-destructive" /> Excluir
                  </Button>
                </>
              ) : null}
              <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
                {salvar.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Salvar perfil
              </Button>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Identificação e quando sugerir</CardTitle>
                <CardDescription>Só o que for diferente dos padrões do escritório é guardado no perfil.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Campo label="Nome do perfil">
                    <Input value={sel.nome} onChange={(e) => setSel({ ...sel, nome: e.target.value })} />
                  </Campo>
                  <Campo label="Descrição (opcional)">
                    <Input value={sel.descricao} onChange={(e) => setSel({ ...sel, descricao: e.target.value })} />
                  </Campo>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Campo label="Enquadramento">
                    <Select value={sel.criterios.enquadramento || QUALQUER} onValueChange={(v) => critSel("enquadramento", v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={QUALQUER}>Qualquer</SelectItem>
                        {(Object.keys(ENQUADRAMENTO_LABEL) as Enquadramento[]).map((k) => (
                          <SelectItem key={k} value={k}>
                            {ENQUADRAMENTO_LABEL[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Campo>
                  <Campo label="Tipo de empresa">
                    <Select value={sel.criterios.tipoEmpresa || QUALQUER} onValueChange={(v) => critSel("tipoEmpresa", v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={QUALQUER}>Qualquer</SelectItem>
                        {(Object.keys(TIPO_LABEL) as TipoEmpresa[]).map((k) => (
                          <SelectItem key={k} value={k}>
                            {TIPO_LABEL[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Campo>
                  <Campo label="Complexidade">
                    <Select value={sel.criterios.complexidade || QUALQUER} onValueChange={(v) => critSel("complexidade", v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={QUALQUER}>Qualquer</SelectItem>
                        {(Object.keys(COMPLEXIDADE_LABEL) as Complexidade[]).map((k) => (
                          <SelectItem key={k} value={k}>
                            {COMPLEXIDADE_LABEL[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Campo>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <Checkbox checked={sel.ativo} onCheckedChange={(v) => setSel({ ...sel, ativo: Boolean(v) })} /> Ativo (aparece e é sugerido)
                  </label>
                  <span className="text-muted-foreground">Sugerido para: {resumoCriterios(sel.criterios)}. O perfil mais específico ganha.</span>
                </div>
              </CardContent>
            </Card>
            <SecaoHonorarios d={dados} set={set} titulo="Valores e condições deste perfil" />
            <SecaoRegras d={dados} set={set} />
            <SecaoPrazosVigencia d={dados} set={set} comAssinatura={false} />
          </>
        )}
      </div>
    </div>
  );
}
