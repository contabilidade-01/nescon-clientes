/**
 * Catálogo e pacotes: é aqui que o escritório define o que vende, por quanto e em que cenários.
 * Tudo o que aparece no assistente, nos botões de cenário e nos valores iniciais vem daqui.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Campo } from "@/components/contratos/FormularioContrato";
import { api } from "@/lib/api";
import { num } from "@/lib/inputNum";
import {
  CATALOGO_PADRAO,
  GRUPO_LABEL,
  MODO_LABEL,
  type CatalogoProposta,
  type GrupoServico,
  type ItemCatalogo,
  type ModoCobranca,
  type Pacote,
} from "@/lib/propostaModelo";

const linhas = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function LinhaCatalogo({ i, up, remover, padrao }: { i: ItemCatalogo; up: (p: Partial<ItemCatalogo>) => void; remover: () => void; padrao: boolean }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className={`rounded-md border p-3 ${i.habilitado ? "" : "opacity-60"}`}>
      <div className="flex items-start gap-2">
        <Checkbox checked={i.habilitado} onCheckedChange={(v) => up({ habilitado: v === true })} className="mt-2" title="Disponível no assistente e na lista" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_150px_150px_110px]">
            <Input value={i.titulo} onChange={(e) => up({ titulo: e.target.value })} className="font-medium" />
            <Select value={i.modo} onValueChange={(v) => up({ modo: v as ModoCobranca })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(MODO_LABEL) as ModoCobranca[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {MODO_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input value={i.unidade} onChange={(e) => up({ unidade: e.target.value })} placeholder="Unidade (ano, mês…)" />
            <Input
              type="number"
              step="any"
              min={0}
              value={i.valorUnit === 0 ? "" : i.valorUnit}
              placeholder="R$"
              onChange={(e) => up({ valorUnit: Math.max(0, num(e.target.value, 0)) })}
              disabled={i.tabelaBase}
              title={i.tabelaBase ? "Vem da tabela de honorários (tipo × complexidade)" : "Valor padrão"}
            />
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="outline">{i.codigo}</Badge>
            <span>{GRUPO_LABEL[i.grupo]}</span>
            {i.tabelaBase ? <span>· valor pela tabela de honorários</span> : null}
            <button type="button" onClick={() => setAberto((a) => !a)} className="ml-auto flex items-center gap-1 hover:text-foreground">
              {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Textos e pagamento
            </button>
            {!padrao ? (
              <button type="button" onClick={remover} title="Excluir serviço" className="hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          {aberto ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Campo label="Entrada na contratação (%)">
                <Input type="number" min={0} max={100} value={i.entradaPct || ""} onChange={(e) => up({ entradaPct: Math.min(100, Math.max(0, num(e.target.value, 0))) })} />
              </Campo>
              <Campo label="Saldo pago">
                <Input value={i.saldoQuando} onChange={(e) => up({ saldoQuando: e.target.value })} />
              </Campo>
              <Campo label="% (modo percentual) e mínimo">
                <div className="flex gap-2">
                  <Input type="number" placeholder="%" value={i.percentual || ""} onChange={(e) => up({ percentual: Math.min(100, Math.max(0, num(e.target.value, 0))) })} />
                  <Input type="number" placeholder="mín. R$" value={i.minimo || ""} onChange={(e) => up({ minimo: Math.max(0, num(e.target.value, 0)) })} />
                </div>
              </Campo>
              <Campo label="Prazo padrão">
                <Input value={i.prazo} onChange={(e) => up({ prazo: e.target.value })} />
              </Campo>
              <Campo label="O que está incluído (uma linha por item)" className="sm:col-span-2">
                <Textarea rows={3} value={i.descricao.join("\n")} onChange={(e) => up({ descricao: linhas(e.target.value) })} />
              </Campo>
              <Campo label="Observações (uma por linha)" className="sm:col-span-2">
                <Textarea rows={2} value={i.obs.join("\n")} onChange={(e) => up({ obs: linhas(e.target.value) })} />
              </Campo>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CartaoPacote({ p, itens, up, remover, padrao }: { p: Pacote; itens: ItemCatalogo[]; up: (x: Partial<Pacote>) => void; remover: () => void; padrao: boolean }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className={`rounded-md border p-3 ${p.habilitado ? "" : "opacity-60"}`}>
      <div className="flex items-start gap-2">
        <Checkbox checked={p.habilitado} onCheckedChange={(v) => up({ habilitado: v === true })} className="mt-2" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={p.nome} onChange={(e) => up({ nome: e.target.value })} className="font-medium" />
            <Input value={p.descricao} onChange={(e) => up({ descricao: e.target.value })} placeholder="Descrição curta" />
          </div>
          <div className="flex flex-wrap gap-1">
            {p.itens.map((r) => (
              <Badge key={r.codigo} variant="secondary">
                {itens.find((i) => i.codigo === r.codigo)?.titulo || r.codigo}
              </Badge>
            ))}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <button type="button" onClick={() => setAberto((a) => !a)} className="flex items-center gap-1 hover:text-foreground">
              {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Serviços do cenário e perguntas
            </button>
            {!padrao ? (
              <button type="button" onClick={remover} title="Excluir cenário" className="ml-auto hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          {aberto ? (
            <div className="space-y-3">
              <div className="grid gap-1 sm:grid-cols-2">
                {itens.map((i) => {
                  const marcado = p.itens.some((r) => r.codigo === i.codigo);
                  return (
                    <label key={i.codigo} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={marcado}
                        onCheckedChange={(v) => up({ itens: v === true ? [...p.itens, { codigo: i.codigo }] : p.itens.filter((r) => r.codigo !== i.codigo) })}
                      />
                      {i.titulo}
                    </label>
                  );
                })}
              </div>
              <Campo label="Roteiro de perguntas (uma por linha) — o assistente segue este roteiro">
                <Textarea rows={4} value={p.perguntas.join("\n")} onChange={(e) => up({ perguntas: linhas(e.target.value) })} />
              </Campo>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function CatalogoEditor({ atual }: { atual: CatalogoProposta }) {
  const queryClient = useQueryClient();
  const [cat, setCat] = useState<CatalogoProposta>(atual);
  const [sujo, setSujo] = useState(false);

  useEffect(() => {
    if (!sujo) setCat(atual);
  }, [atual, sujo]);

  const mexer = (fn: (c: CatalogoProposta) => CatalogoProposta) => {
    setCat(fn);
    setSujo(true);
  };

  const salvar = useMutation({
    mutationFn: (c: CatalogoProposta | null) => api.admin.propostas.salvarCatalogo(c),
    onSuccess: () => {
      toast.success("Catálogo salvo. Vale para todas as propostas novas.");
      setSujo(false);
      queryClient.invalidateQueries({ queryKey: ["admin-propostas", "catalogo"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const codigosPadrao = new Set(CATALOGO_PADRAO.itens.map((i) => i.codigo));
  const idsPadrao = new Set(CATALOGO_PADRAO.pacotes.map((p) => p.id));
  const pd = cat.padroes;
  const setPd = <K extends keyof CatalogoProposta["padroes"]>(k: K, patch: Partial<CatalogoProposta["padroes"][K]>) =>
    mexer((c) => ({ ...c, padroes: { ...c.padroes, [k]: { ...c.padroes[k], ...patch } } }));

  function novoServico() {
    const nome = window.prompt("Nome do novo serviço (ex.: Imposto de Renda Pessoa Física)");
    if (!nome?.trim()) return;
    let codigo = slug(nome) || "servico";
    while (cat.itens.some((i) => i.codigo === codigo)) codigo += "_2";
    const novo: ItemCatalogo = {
      codigo,
      grupo: "avulso",
      titulo: nome.trim(),
      unidade: "serviço",
      modo: "unico",
      valorUnit: 0,
      quantidade: 1,
      base: 0,
      percentual: 0,
      minimo: 0,
      entradaPct: 0,
      parcelas: 1,
      saldoQuando: "ao final do processo",
      escada: [],
      descricao: [],
      prazo: "",
      pagamento: "",
      obs: [],
      habilitado: true,
    };
    mexer((c) => ({ ...c, itens: [...c.itens, novo] }));
  }

  function novoPacote() {
    const nome = window.prompt("Nome do novo cenário (ex.: Regularização de empresa baixada)");
    if (!nome?.trim()) return;
    let id = slug(nome) || "cenario";
    while (cat.pacotes.some((p) => p.id === id)) id += "_2";
    mexer((c) => ({ ...c, pacotes: [...c.pacotes, { id, nome: nome.trim(), descricao: "", itens: [], perguntas: [], habilitado: true }] }));
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">
          O que o escritório vende, por quanto e em quais cenários. O assistente e os botões de cenário só usam o que está marcado aqui.
        </p>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (window.confirm("Voltar tudo ao catálogo padrão? Valores e textos que você mudou serão perdidos.")) {
              salvar.mutate(null, { onSuccess: () => setCat(CATALOGO_PADRAO) });
            }
          }}
        >
          <RotateCcw className="mr-1 h-4 w-4" /> Restaurar padrão
        </Button>
        <Button size="sm" onClick={() => salvar.mutate(cat)} disabled={salvar.isPending || !sujo}>
          {salvar.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Salvar catálogo
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Padrões do escritório</CardTitle>
          <CardDescription>Entram em toda proposta nova. A mensalidade ME/EPP usa a tabela de Atualização de Honorários (ou a faixa 280–550).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Campo label="Razão / nome (rodapé e assinatura)">
            <Input value={pd.contratada.razao} onChange={(e) => setPd("contratada", { razao: e.target.value })} />
          </Campo>
          <Campo label="CNPJ">
            <Input value={pd.contratada.cnpj} onChange={(e) => setPd("contratada", { cnpj: e.target.value })} />
          </Campo>
          <Campo label="Endereço (rodapé)">
            <Input value={pd.contratada.endereco} onChange={(e) => setPd("contratada", { endereco: e.target.value })} />
          </Campo>
          <Campo label="Cidade">
            <Input value={pd.cabecalho.cidade} onChange={(e) => setPd("cabecalho", { cidade: e.target.value })} />
          </Campo>
          <Campo label="Validade (dias)">
            <Input type="number" min={1} value={pd.cabecalho.validadeDias} onChange={(e) => setPd("cabecalho", { validadeDias: Math.max(1, Math.floor(num(e.target.value, 30))) })} />
          </Campo>
          <Campo label="Assina / cargo">
            <div className="flex gap-2">
              <Input value={pd.assinatura.nome} onChange={(e) => setPd("assinatura", { nome: e.target.value })} />
              <Input value={pd.assinatura.cargo} onChange={(e) => setPd("assinatura", { cargo: e.target.value })} />
            </div>
          </Campo>
          <Campo label="Vencimento da mensalidade (dia)">
            <Input type="number" min={1} max={31} value={pd.condicoes.vencimentoDia} onChange={(e) => setPd("condicoes", { vencimentoDia: Math.min(31, Math.max(1, Math.floor(num(e.target.value, 15)))) })} />
          </Campo>
          <Campo label="Forma de pagamento">
            <Input value={pd.condicoes.formaPagamento} onChange={(e) => setPd("condicoes", { formaPagamento: e.target.value })} />
          </Campo>
          <Campo label="Chave PIX">
            <Input value={pd.condicoes.chavePix} onChange={(e) => setPd("condicoes", { chavePix: e.target.value })} />
          </Campo>
          <Campo label="Funcionários incluídos">
            <Input type="number" min={0} value={pd.condicoes.funcionariosIncluidos} onChange={(e) => setPd("condicoes", { funcionariosIncluidos: Math.max(0, Math.floor(num(e.target.value, 3))) })} />
          </Campo>
          <Campo label="Funcionário adicional (R$/mês)">
            <Input type="number" min={0} value={pd.condicoes.valorFuncionarioExtra} onChange={(e) => setPd("condicoes", { valorFuncionarioExtra: Math.max(0, num(e.target.value, 70)) })} />
          </Campo>
          <Campo label="Guias com antecedência (dias)">
            <Input type="number" min={0} value={pd.condicoes.guiasAntecedenciaDias} onChange={(e) => setPd("condicoes", { guiasAntecedenciaDias: Math.max(0, Math.floor(num(e.target.value, 5))) })} />
          </Campo>
          <Campo label="Reajuste (texto padrão)" className="sm:col-span-3">
            <Input value={pd.condicoes.reajuste} onChange={(e) => setPd("condicoes", { reajuste: e.target.value })} placeholder="Ex.: reajuste anual pelo IPCA a cada janeiro" />
          </Campo>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Cenários (pacotes)</CardTitle>
            <div className="flex-1" />
            <Button size="sm" variant="outline" onClick={novoPacote}>
              <Plus className="mr-1 h-4 w-4" /> Novo cenário
            </Button>
          </div>
          <CardDescription>Cada cenário traz um conjunto de serviços e o roteiro do que perguntar ao cliente.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {cat.pacotes.map((p) => (
            <CartaoPacote
              key={p.id}
              p={p}
              itens={cat.itens}
              padrao={idsPadrao.has(p.id)}
              up={(x) => mexer((c) => ({ ...c, pacotes: c.pacotes.map((k) => (k.id === p.id ? { ...k, ...x } : k)) }))}
              remover={() => mexer((c) => ({ ...c, pacotes: c.pacotes.filter((k) => k.id !== p.id) }))}
            />
          ))}
        </CardContent>
      </Card>

      {(Object.keys(GRUPO_LABEL) as GrupoServico[]).map((g) => {
        const itens = cat.itens.filter((i) => i.grupo === g);
        if (!itens.length) return null;
        return (
          <Card key={g}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{GRUPO_LABEL[g]}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {itens.map((i) => (
                <LinhaCatalogo
                  key={i.codigo}
                  i={i}
                  padrao={codigosPadrao.has(i.codigo)}
                  up={(x) => mexer((c) => ({ ...c, itens: c.itens.map((k) => (k.codigo === i.codigo ? { ...k, ...x } : k)) }))}
                  remover={() =>
                    mexer((c) => ({
                      ...c,
                      itens: c.itens.filter((k) => k.codigo !== i.codigo),
                      pacotes: c.pacotes.map((p) => ({ ...p, itens: p.itens.filter((r) => r.codigo !== i.codigo) })),
                    }))
                  }
                />
              ))}
            </CardContent>
          </Card>
        );
      })}
      <div>
        <Button variant="outline" size="sm" onClick={novoServico}>
          <Plus className="mr-1 h-4 w-4" /> Novo serviço
        </Button>
      </div>
    </div>
  );
}
