/**
 * Criação rápida: empresa → perfil (sugerido) → 4 campos que variam → rascunho pronto.
 * Tudo o mais vem das camadas: padrões do escritório, perfil e cadastro prévio da empresa.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import { usePresets } from "@/components/contratos/AbaPerfis";
import { Campo } from "@/components/contratos/FormularioContrato";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAdminCompanies } from "@/hooks/useAdminCompanies";
import { api } from "@/lib/api";
import { camadasDados, sugerirPreset, type ContratoPreset } from "@/lib/contratoCampos";
import { camposPendentes, dadosPadrao, tituloContrato, type ContratoDados, type ContratoParcial } from "@/lib/contratoModelo";
import { num } from "@/lib/inputNum";
import { maskCNPJ } from "@/lib/masks";

const SEM_PERFIL = "__nenhum";

export function NovoContratoRapido({ aberto, onFechar, onCriado }: { aberto: boolean; onFechar: () => void; onCriado: (id: string) => void }) {
  const queryClient = useQueryClient();
  const empresas = useAdminCompanies();
  const presets = usePresets();
  const [companyId, setCompanyId] = useState("");
  const [cadastro, setCadastro] = useState<ContratoParcial | null>(null);
  const [padroes, setPadroes] = useState<ContratoParcial | null>(null);
  const [presetId, setPresetId] = useState<string>(SEM_PERFIL);
  const [presetManual, setPresetManual] = useState(false);
  const [valor, setValor] = useState<number | null>(null);
  const [vencimento, setVencimento] = useState<number | null>(null);
  const [inicio, setInicio] = useState("");
  const [funcionarios, setFuncionarios] = useState<number | null>(null);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setCompanyId("");
    setCadastro(null);
    setPresetId(SEM_PERFIL);
    setPresetManual(false);
    setValor(null);
    setVencimento(null);
    setInicio("");
    setFuncionarios(null);
    api.admin.contratos
      .padroes()
      .then((r) => setPadroes(r.padroes))
      .catch(() => setPadroes(null));
  }, [aberto]);

  const empresa = empresas.data?.find((e) => e.id === companyId);
  const basico: ContratoParcial | null = empresa
    ? {
        contratante: {
          razao: empresa.name,
          cnpj: maskCNPJ(empresa.cnpj.replace(/\D/g, "")),
          email: empresa.contact_email || "",
          telefone: empresa.phone || "",
        },
      }
    : null;
  const lista = presets.data || [];
  const preset: ContratoPreset | null = presetId === SEM_PERFIL ? null : lista.find((p) => p.id === presetId) || null;

  // Camadas sem os campos digitados: base para sugerir o perfil e para mostrar os valores iniciais.
  const camadas = useMemo(
    () => camadasDados(dadosPadrao(), { padroes, preset, basico, cadastro }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [padroes, preset, empresa, cadastro]
  );
  const sugerido = useMemo(
    () => sugerirPreset(lista, camadasDados(dadosPadrao(), { padroes, basico, cadastro }).objeto),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lista, padroes, empresa, cadastro]
  );

  // Sugere o perfil assim que a ficha da empresa chega, sem atropelar uma escolha manual.
  useEffect(() => {
    if (!presetManual && sugerido) setPresetId(sugerido.id);
  }, [sugerido, presetManual]);

  // Trocar empresa ou perfil recarrega os valores iniciais dos 4 campos.
  useEffect(() => {
    setValor(null);
    setVencimento(null);
    setFuncionarios(null);
  }, [companyId, presetId]);

  async function escolherEmpresa(id: string) {
    setCompanyId(id);
    setPresetManual(false);
    setPresetId(SEM_PERFIL);
    setCarregando(true);
    try {
      const r = await api.admin.contratos.cadastro(id);
      setCadastro(r.dados);
    } catch {
      setCadastro(null);
    } finally {
      setCarregando(false);
    }
  }

  const final: ContratoDados = useMemo(() => {
    const d = camadas;
    return {
      ...d,
      honorarios: { ...d.honorarios, valorMensal: valor ?? d.honorarios.valorMensal, vencimentoDia: vencimento ?? d.honorarios.vencimentoDia },
      objeto: { ...d.objeto, funcionariosIncluidos: funcionarios ?? d.objeto.funcionariosIncluidos },
      vigencia: { ...d.vigencia, dataInicio: inicio || d.vigencia.dataInicio },
    };
  }, [camadas, valor, vencimento, funcionarios, inicio]);

  const pendentes = camposPendentes(final);

  const criar = useMutation({
    mutationFn: () => api.admin.contratos.create({ company_id: companyId, titulo: tituloContrato(final), dados: final }),
    onSuccess: (c) => {
      toast.success("Rascunho criado. Revise a prévia e salve para o portal.");
      queryClient.invalidateQueries({ queryKey: ["admin-contratos"] });
      onCriado(c.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? onFechar() : null)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" /> Novo contrato rápido
          </DialogTitle>
          <DialogDescription>Escolha a empresa e confirme o que varia. Padrões, perfil e cadastro prévio preenchem o resto; você ajusta na prévia.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Campo label="Empresa">
            <Select value={companyId} onValueChange={escolherEmpresa}>
              <SelectTrigger>
                <SelectValue placeholder="Selecionar empresa…" />
              </SelectTrigger>
              <SelectContent>
                {empresas.data?.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name} — {maskCNPJ(e.cnpj.replace(/\D/g, ""))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>

          {companyId ? (
            carregando ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando a ficha…
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {cadastro ? <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">cadastro prévio aplicado</Badge> : <Badge variant="secondary">sem cadastro prévio: só nome e CNPJ do portal</Badge>}
                </div>
                <Campo label="Perfil de honorário">
                  <Select
                    value={presetId}
                    onValueChange={(v) => {
                      setPresetManual(true);
                      setPresetId(v);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SEM_PERFIL}>Sem perfil</SelectItem>
                      {lista
                        .filter((p) => p.ativo)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.nome}
                            {sugerido?.id === p.id ? " (sugerido)" : ""}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Campo>
                <div className="grid grid-cols-2 gap-2">
                  <Campo label="Honorário mensal (R$)">
                    <Input type="number" step="0.01" min="0" value={final.honorarios.valorMensal} onChange={(e) => setValor(num(e.target.value))} />
                  </Campo>
                  <Campo label="Vencimento (dia)">
                    <Input type="number" min="1" max="31" value={final.honorarios.vencimentoDia} onChange={(e) => setVencimento(Math.max(1, Math.min(31, num(e.target.value, 15))))} />
                  </Campo>
                  <Campo label="Início dos serviços">
                    <Input type="date" value={final.vigencia.dataInicio} onChange={(e) => setInicio(e.target.value)} />
                  </Campo>
                  <Campo label="Empregados incluídos">
                    <Input type="number" min="0" value={final.objeto.funcionariosIncluidos} onChange={(e) => setFuncionarios(Math.max(0, Math.floor(num(e.target.value, 0))))} />
                  </Campo>
                </div>
                {pendentes.length ? (
                  <p className="text-xs text-amber-700">Ainda em branco (aparece em amarelo, você completa no editor): {pendentes.join(", ")}.</p>
                ) : (
                  <p className="text-xs text-emerald-700">Nenhum campo em branco.</p>
                )}
              </>
            )
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => criar.mutate()} disabled={!companyId || carregando || criar.isPending}>
            {criar.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Zap className="h-4 w-4 mr-1" />} Criar e abrir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
