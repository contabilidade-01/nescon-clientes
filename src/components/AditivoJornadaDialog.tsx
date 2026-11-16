import { useState } from "react";
import { FileSignature } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EmployeeJornada } from "@/lib/api";
import { baixarAditivoJornadaPdf } from "@/lib/generateAditivoJornadaPdf";
import { ESCALAS_FUNCIONARIO, FOLGAS_FUNCIONARIO, ETAPA_42H, hojeISO, resumoJornada, situacaoJornada } from "@/lib/jornadaFuncionario";

const campoSelect =
  "mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * Gera o termo aditivo de alteração de jornada de um funcionário e, se o cliente quiser,
 * grava a nova jornada no cadastro. Começa sugerindo 40h em 5x2 (vale nas duas etapas).
 */
export function AditivoJornadaDialog({
  empresa,
  funcionario,
  onSalvarJornada,
}: {
  empresa: { name: string; cnpj: string };
  funcionario: { id: string; name: string; cpf: string } & EmployeeJornada;
  onSalvarJornada?: (j: EmployeeJornada) => Promise<unknown>;
}) {
  const hoje = hojeISO();
  const [aberto, setAberto] = useState(false);
  const [inicio, setInicio] = useState(hoje < ETAPA_42H.inicio ? "2026-12-14" : hoje);
  const [carga, setCarga] = useState("40");
  const [escala, setEscala] = useState("5x2");
  const [folga, setFolga] = useState("Sábado e domingo");
  const [entrada, setEntrada] = useState(funcionario.horario_entrada || "08:00");
  const [saida, setSaida] = useState("17:00");
  const [intervalo, setIntervalo] = useState("1 hora");
  const [cidade, setCidade] = useState("");
  const [atualizar, setAtualizar] = useState(true);
  const [gerando, setGerando] = useState(false);

  const nova = { carga_semanal: carga, escala, folga, horario_entrada: entrada, horario_saida: saida };
  const situacao = situacaoJornada(nova, inicio || hoje);

  const gerar = async () => {
    setGerando(true);
    try {
      baixarAditivoJornadaPdf({
        empresaNome: empresa.name,
        empresaCnpj: empresa.cnpj,
        funcionarioNome: funcionario.name,
        funcionarioCpf: funcionario.cpf || "",
        jornadaAnterior: resumoJornada(funcionario) || undefined,
        inicio,
        cargaSemanal: carga,
        escala,
        folga,
        entrada,
        saida,
        intervalo,
        cidade,
        dataAssinatura: hoje,
        comAcordo: situacao.nivel === "atencao" && escala !== "12x36",
      });
      if (atualizar && onSalvarJornada) await onSalvarJornada(nova);
      toast.success(atualizar ? "Aditivo gerado e jornada atualizada no cadastro" : "Aditivo gerado");
      setAberto(false);
    } catch (e) {
      toast.error((e as Error).message || "Erro ao gerar o aditivo");
    } finally {
      setGerando(false);
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Aditivo de jornada">
          <FileSignature className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Aditivo de jornada</DialogTitle>
          <DialogDescription>
            {funcionario.name}. O termo sai em PDF para assinatura; o Departamento Pessoal lança a mudança na folha.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Vale a partir de</Label>
            <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Horas por semana</Label>
            <Input inputMode="decimal" value={carga} onChange={(e) => setCarga(e.target.value.replace(/[^\d,.]/g, ""))} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Escala</Label>
            <select className={campoSelect} value={escala} onChange={(e) => setEscala(e.target.value)} aria-label="Escala do aditivo">
              {ESCALAS_FUNCIONARIO.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Folga</Label>
            <select className={campoSelect} value={folga} onChange={(e) => setFolga(e.target.value)} aria-label="Folga do aditivo">
              {FOLGAS_FUNCIONARIO.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Entrada</Label>
            <Input type="time" value={entrada} onChange={(e) => setEntrada(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Saída</Label>
            <Input type="time" value={saida} onChange={(e) => setSaida(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Intervalo</Label>
            <select className={campoSelect} value={intervalo} onChange={(e) => setIntervalo(e.target.value)} aria-label="Intervalo do aditivo">
              {["15 minutos", "30 minutos", "1 hora", "2 horas"].map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Cidade</Label>
            <Input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Ex: Campinas/SP" className="mt-1" />
          </div>
        </div>
        {situacao.nivel !== "ok" && situacao.nivel !== "sem_dado" && (
          <p
            className={`rounded-md border px-2 py-1.5 text-xs ${
              situacao.nivel === "fora"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
            }`}
          >
            {situacao.rotulo}: {situacao.detalhe}
          </p>
        )}
        {onSalvarJornada && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={atualizar} onChange={(e) => setAtualizar(e.target.checked)} />
            Atualizar a jornada no cadastro do funcionário
          </label>
        )}
        <DialogFooter>
          <Button onClick={gerar} disabled={gerando || !inicio || !carga || situacao.nivel === "fora"} className="gap-1">
            <FileSignature className="h-4 w-4" /> Gerar aditivo (PDF)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
