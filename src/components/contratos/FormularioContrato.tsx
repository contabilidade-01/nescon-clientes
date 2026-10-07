/**
 * Seções do formulário de contrato, reutilizadas em três lugares: o editor do
 * contrato (todas), o cadastro prévio da empresa (contratante, modelo, valores,
 * vigência) e os padrões do escritório (contratada, regras, prazos).
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  COMPLEXIDADE_LABEL,
  ENQUADRAMENTO_LABEL,
  MODELO_LABEL,
  TIPO_LABEL,
  brl,
  faixaTexto,
  valorSugerido,
  type Complexidade,
  type ContratoDados,
  type Enquadramento,
  type ModeloContrato,
  type PadraoHonorario,
  type TipoEmpresa,
} from "@/lib/contratoModelo";
import { num } from "@/lib/inputNum";
import { maskCNPJ, maskCPF } from "@/lib/masks";

export type SetSecao = <K extends keyof ContratoDados>(sec: K, patch: Partial<ContratoDados[K]>) => void;

export type SecProps = { d: ContratoDados; set: SetSecao; ro?: boolean };

export function Campo({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1 ${className || ""}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function inteiro(v: string, min: number, fallback: number): number {
  return Math.max(min, Math.floor(num(v, fallback)));
}

/** Modelo, enquadramento, tipo e complexidade, com a faixa sugerida. */
export function SecaoModeloFaixa({ d, set, ro, padroesTabela }: SecProps & { padroesTabela?: PadraoHonorario[] | null }) {
  const sugestao = valorSugerido(d.objeto.enquadramento, d.objeto.tipoEmpresa, d.objeto.complexidade, padroesTabela);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Modelo e faixa de honorários</CardTitle>
        <CardDescription>O modelo define o texto; a faixa só sugere o valor, que fica livre para negociar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Campo label="Modelo de contrato">
          <Select
            value={d.objeto.modelo}
            onValueChange={(v) => {
              const modelo = v as ModeloContrato;
              set("objeto", {
                modelo,
                enquadramento: modelo === "mei" ? "mei" : d.objeto.enquadramento === "mei" ? "simples" : d.objeto.enquadramento,
                funcionariosIncluidos: modelo === "mei" ? 1 : d.objeto.funcionariosIncluidos,
              });
            }}
            disabled={ro}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODELO_LABEL) as ModeloContrato[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {MODELO_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <div className="grid grid-cols-3 gap-2">
          <Campo label="Enquadramento">
            <Select value={d.objeto.enquadramento} onValueChange={(v) => set("objeto", { enquadramento: v as Enquadramento })} disabled={ro}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ENQUADRAMENTO_LABEL) as Enquadramento[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {ENQUADRAMENTO_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Tipo de empresa">
            <Select value={d.objeto.tipoEmpresa} onValueChange={(v) => set("objeto", { tipoEmpresa: v as TipoEmpresa })} disabled={ro}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TIPO_LABEL) as TipoEmpresa[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {TIPO_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Complexidade">
            <Select value={d.objeto.complexidade} onValueChange={(v) => set("objeto", { complexidade: v as Complexidade })} disabled={ro}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(COMPLEXIDADE_LABEL) as Complexidade[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {COMPLEXIDADE_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {sugestao.origem === "nenhum" ? (
            <span className="text-muted-foreground">MEI: sem faixa fixa, informe o valor em Honorários.</span>
          ) : (
            <>
              <span className="text-muted-foreground">
                Faixa {TIPO_LABEL[d.objeto.tipoEmpresa].toLowerCase()}: {faixaTexto(d.objeto.tipoEmpresa)} · sugerido {brl(sugestao.valor)}
                {sugestao.origem === "tabela" ? " (tabela do portal)" : ""}
              </span>
              <Button size="sm" variant="outline" disabled={ro} onClick={() => set("honorarios", { valorMensal: sugestao.valor })}>
                Usar {brl(sugestao.valor)}
              </Button>
            </>
          )}
          {d.honorarios.valorMensal ? <Badge variant="secondary">Contrato: {brl(d.honorarios.valorMensal)}</Badge> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function SecaoContratante({ d, set, ro, cabecalho }: SecProps & { cabecalho?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Contratante</CardTitle>
        <CardDescription>Dados da empresa cliente e de quem assina por ela, como no contrato social.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {cabecalho}
        <Campo label="Razão social">
          <Input value={d.contratante.razao} onChange={(e) => set("contratante", { razao: e.target.value })} disabled={ro} />
        </Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo label="CNPJ">
            <Input value={d.contratante.cnpj} onChange={(e) => set("contratante", { cnpj: maskCNPJ(e.target.value) })} disabled={ro} />
          </Campo>
          <Campo label="NIRE (opcional)">
            <Input value={d.contratante.nire} onChange={(e) => set("contratante", { nire: e.target.value })} disabled={ro} />
          </Campo>
        </div>
        <Campo label="Tipo societário / porte (opcional)">
          <Input placeholder="ex.: sociedade empresária limitada, empresa de pequeno porte" value={d.contratante.tipoSocietario} onChange={(e) => set("contratante", { tipoSocietario: e.target.value })} disabled={ro} />
        </Campo>
        <Campo label="Endereço completo da sede">
          <Textarea rows={2} value={d.contratante.endereco} onChange={(e) => set("contratante", { endereco: e.target.value })} disabled={ro} />
        </Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo label="E-mail (recebe guias, cobrança e contrato)">
            <Input type="email" value={d.contratante.email} onChange={(e) => set("contratante", { email: e.target.value })} disabled={ro} />
          </Campo>
          <Campo label="Telefone / WhatsApp">
            <Input value={d.contratante.telefone} onChange={(e) => set("contratante", { telefone: e.target.value })} disabled={ro} />
          </Campo>
        </div>
        <Campo label="Representante legal (quem assina)">
          <Input value={d.contratante.repNome} onChange={(e) => set("contratante", { repNome: e.target.value })} disabled={ro} />
        </Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo label="CPF do representante">
            <Input value={d.contratante.repCpf} onChange={(e) => set("contratante", { repCpf: maskCPF(e.target.value) })} disabled={ro} />
          </Campo>
          <Campo label="Qualificação (opcional)">
            <Input placeholder="ex.: brasileira, empresária, casada" value={d.contratante.repQualificacao} onChange={(e) => set("contratante", { repQualificacao: e.target.value })} disabled={ro} />
          </Campo>
        </div>
        <Campo label="Endereço do representante (opcional)">
          <Input value={d.contratante.repEndereco} onChange={(e) => set("contratante", { repEndereco: e.target.value })} disabled={ro} />
        </Campo>
        <Campo label="Poderes de representação (opcional)">
          <Input placeholder="ex.: com poderes de administração individual conforme a cláusula 7ª do contrato social" value={d.contratante.repPoderes} onChange={(e) => set("contratante", { repPoderes: e.target.value })} disabled={ro} />
        </Campo>
      </CardContent>
    </Card>
  );
}

export function SecaoContratada({ d, set, ro }: SecProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Contratada (escritório)</CardTitle>
        <CardDescription>Identificação da NESCON no contrato. Campo vazio é simplesmente omitido do texto.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Campo label="Razão social">
          <Input value={d.contratada.razao} onChange={(e) => set("contratada", { razao: e.target.value })} disabled={ro} />
        </Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo label="CNPJ">
            <Input value={d.contratada.cnpj} onChange={(e) => set("contratada", { cnpj: maskCNPJ(e.target.value) })} disabled={ro} />
          </Campo>
          <Campo label="CRC da organização contábil (opcional)">
            <Input value={d.contratada.crcOrg} onChange={(e) => set("contratada", { crcOrg: e.target.value })} disabled={ro} />
          </Campo>
        </div>
        <Campo label="Endereço completo">
          <Textarea rows={2} value={d.contratada.endereco} onChange={(e) => set("contratada", { endereco: e.target.value })} disabled={ro} />
        </Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo label="E-mail (opcional)">
            <Input type="email" value={d.contratada.email} onChange={(e) => set("contratada", { email: e.target.value })} disabled={ro} />
          </Campo>
          <Campo label="Telefone (opcional)">
            <Input value={d.contratada.telefone} onChange={(e) => set("contratada", { telefone: e.target.value })} disabled={ro} />
          </Campo>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Representante legal">
            <Input value={d.contratada.repNome} onChange={(e) => set("contratada", { repNome: e.target.value })} disabled={ro} />
          </Campo>
          <Campo label="Cargo">
            <Input value={d.contratada.repCargo} onChange={(e) => set("contratada", { repCargo: e.target.value })} disabled={ro} />
          </Campo>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Responsável técnico">
            <Input value={d.contratada.respTecnico} onChange={(e) => set("contratada", { respTecnico: e.target.value })} disabled={ro} />
          </Campo>
          <Campo label="CRC do responsável">
            <Input value={d.contratada.crcRt} onChange={(e) => set("contratada", { crcRt: e.target.value })} disabled={ro} />
          </Campo>
        </div>
      </CardContent>
    </Card>
  );
}

export function SecaoHonorarios({ d, set, ro, titulo }: SecProps & { titulo?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{titulo || "Serviços e honorários"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Campo label="Áreas contratadas (o que ficar desmarcado sai do objeto, com aviso no contrato)">
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox checked={d.objeto.areaContabil} onCheckedChange={(v) => set("objeto", { areaContabil: Boolean(v) })} disabled={ro} /> Contábil
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={d.objeto.areaFiscal} onCheckedChange={(v) => set("objeto", { areaFiscal: Boolean(v) })} disabled={ro} /> Fiscal
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={d.objeto.areaPessoal} onCheckedChange={(v) => set("objeto", { areaPessoal: Boolean(v) })} disabled={ro} /> Departamento pessoal
            </label>
          </div>
        </Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Regime tributário (opcional)">
            <Input placeholder="ex.: Simples Nacional" value={d.objeto.regimeTributario} onChange={(e) => set("objeto", { regimeTributario: e.target.value })} disabled={ro} />
          </Campo>
          <Campo label="Balancetes">
            <Select value={d.objeto.balancetes} onValueChange={(v) => set("objeto", { balancetes: v as ContratoDados["objeto"]["balancetes"] })} disabled={ro}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mensal">Mensais</SelectItem>
                <SelectItem value="trimestral">Trimestrais</SelectItem>
                <SelectItem value="semestral">Semestrais</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Campo label="Honorário mensal (R$)">
            <Input type="number" step="0.01" min="0" value={d.honorarios.valorMensal} onChange={(e) => set("honorarios", { valorMensal: num(e.target.value) })} disabled={ro} />
          </Campo>
          <Campo label="Vencimento (dia)">
            <Input type="number" min="1" max="31" value={d.honorarios.vencimentoDia} onChange={(e) => set("honorarios", { vencimentoDia: Math.max(1, Math.min(31, num(e.target.value, 15))) })} disabled={ro} />
          </Campo>
          <Campo label="Faturamento até (R$)">
            <Input type="number" step="1000" min="0" value={d.honorarios.faturamentoLimite} onChange={(e) => set("honorarios", { faturamentoLimite: num(e.target.value) })} disabled={ro} />
          </Campo>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Campo label="Empregados incluídos">
            <Input type="number" min="0" value={d.objeto.funcionariosIncluidos} onChange={(e) => set("objeto", { funcionariosIncluidos: inteiro(e.target.value, 0, 0) })} disabled={ro} />
          </Campo>
          <Campo label="Por empregado extra (R$)">
            <Input type="number" step="0.01" min="0" value={d.honorarios.valorFuncAdicional} onChange={(e) => set("honorarios", { valorFuncAdicional: num(e.target.value) })} disabled={ro} />
          </Campo>
          <Campo label="Meio de pagamento">
            <Input placeholder="ex.: boleto bancário ou Pix" value={d.honorarios.meioPagamento} onChange={(e) => set("honorarios", { meioPagamento: e.target.value })} disabled={ro} />
          </Campo>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Competência cobrada">
            <Select value={d.honorarios.competenciaReferencia} onValueChange={(v) => set("honorarios", { competenciaReferencia: v as "corrente" | "seguinte" })} disabled={ro}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="corrente">Mês corrente (paga o mês em curso)</SelectItem>
                <SelectItem value="seguinte">Mês vencido (paga o mês anterior)</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="1ª cobrança (opcional)">
            <Input type="date" value={d.honorarios.primeiraCobranca} onChange={(e) => set("honorarios", { primeiraCobranca: e.target.value })} disabled={ro} />
          </Campo>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Acima da faixa: acréscimo (R$)">
            <Input type="number" step="0.01" min="0" value={d.honorarios.faixaAdicionalValor} onChange={(e) => set("honorarios", { faixaAdicionalValor: Math.max(0, num(e.target.value)) })} disabled={ro} />
          </Campo>
          <Campo label="a cada (R$) de faturamento excedente">
            <Input type="number" step="1000" min="0" value={d.honorarios.faixaPasso} onChange={(e) => set("honorarios", { faixaPasso: Math.max(0, num(e.target.value)) })} disabled={ro} />
          </Campo>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={d.honorarios.decimoTerceiro} onCheckedChange={(v) => set("honorarios", { decimoTerceiro: Boolean(v) })} disabled={ro} />
          Cobrar 13º honorário (fixo, valor-base, em duas parcelas)
        </label>
        {d.honorarios.decimoTerceiro ? (
          <div className="grid grid-cols-2 gap-2">
            <Campo label="13º: 1ª parcela (dia/mês)">
              <Input placeholder="25/11" value={d.honorarios.decimoParcela1} onChange={(e) => set("honorarios", { decimoParcela1: e.target.value })} disabled={ro} />
            </Campo>
            <Campo label="13º: 2ª parcela (dia/mês)">
              <Input placeholder="18/12" value={d.honorarios.decimoParcela2} onChange={(e) => set("honorarios", { decimoParcela2: e.target.value })} disabled={ro} />
            </Campo>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Multas, juros, reajuste, retroativo, recálculo, inadimplência e limites de multa. */
export function SecaoRegras({ d, set, ro }: SecProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Regras de cobrança e penalidades</CardTitle>
        <CardDescription>Tudo aqui entra no texto das cláusulas 2, 5 e 6.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Campo label="Multa por atraso (%)">
            <Input type="number" step="0.5" min="0" value={d.honorarios.multaPct} onChange={(e) => set("honorarios", { multaPct: num(e.target.value) })} disabled={ro} />
          </Campo>
          <Campo label="Juros ao mês (%)">
            <Input type="number" step="0.5" min="0" value={d.honorarios.jurosPct} onChange={(e) => set("honorarios", { jurosPct: num(e.target.value) })} disabled={ro} />
          </Campo>
          <Campo label="Inadimplência: dias para regularizar">
            <Input type="number" min="1" value={d.honorarios.inadimplenciaDias} onChange={(e) => set("honorarios", { inadimplenciaDias: inteiro(e.target.value, 1, 10) })} disabled={ro} />
          </Campo>
        </div>
        <Campo label="Índice do reajuste anual automático">
          <Input placeholder="IPCA (IBGE)" value={d.honorarios.reajusteIndice} onChange={(e) => set("honorarios", { reajusteIndice: e.target.value })} disabled={ro} />
        </Campo>
        <div className="grid grid-cols-3 gap-2">
          <Campo label="Retroativo: a partir de (dias de atraso)">
            <Input type="number" min="1" value={d.honorarios.retroativoDias} onChange={(e) => set("honorarios", { retroativoDias: inteiro(e.target.value, 1, 90) })} disabled={ro} />
          </Campo>
          <Campo label="Retroativo: % da mensalidade (0 = orçamento)">
            <Input type="number" min="0" max="300" value={d.honorarios.retroativoPct} onChange={(e) => set("honorarios", { retroativoPct: Math.max(0, num(e.target.value)) })} disabled={ro} />
          </Campo>
          <Campo label="2º recálculo de guia (R$ por guia)">
            <Input type="number" step="0.01" min="0" value={d.honorarios.recalculoGuiaValor} onChange={(e) => set("honorarios", { recalculoGuiaValor: Math.max(0, num(e.target.value)) })} disabled={ro} />
          </Campo>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Campo label="Justa causa: dias para corrigir">
            <Input type="number" min="1" value={d.vigencia.correcaoDias} onChange={(e) => set("vigencia", { correcaoDias: inteiro(e.target.value, 1, 10) })} disabled={ro} />
          </Campo>
          <Campo label="Multa por dispensar o aviso (limite em mensalidades)">
            <Input type="number" min="0" step="0.5" value={d.vigencia.multaAvisoMensalidades} onChange={(e) => set("vigencia", { multaAvisoMensalidades: Math.max(0, num(e.target.value)) })} disabled={ro} />
          </Campo>
          <Campo label="Multa por infração (mensalidades)">
            <Input type="number" min="0" step="0.5" value={d.vigencia.multaInfracaoMensalidades} onChange={(e) => set("vigencia", { multaInfracaoMensalidades: Math.max(0, num(e.target.value)) })} disabled={ro} />
          </Campo>
        </div>
      </CardContent>
    </Card>
  );
}

export function SecaoPrazosVigencia({
  d,
  set,
  ro,
  comAssinatura = true,
  semTestemunhas = false,
}: SecProps & { comAssinatura?: boolean; semTestemunhas?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Prazos, atendimento e vigência</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Campo label="Variáveis da folha até (dia do mês)">
            <Input placeholder="ex.: 2" value={d.prazos.diaVariaveisFolha} onChange={(e) => set("prazos", { diaVariaveisFolha: e.target.value })} disabled={ro} />
          </Campo>
          <Campo label="Docs financeiros: até (dias após o mês)">
            <Input type="number" min="1" value={d.prazos.diaDocsFinanceiros} onChange={(e) => set("prazos", { diaDocsFinanceiros: inteiro(e.target.value, 1, 5) })} disabled={ro} />
          </Campo>
          <Campo label="Guias com (dias) de antecedência">
            <Input type="number" min="1" value={d.prazos.diasGuias} onChange={(e) => set("prazos", { diasGuias: inteiro(e.target.value, 1, 5) })} disabled={ro} />
          </Campo>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Campo label="Horário de atendimento">
            <Input placeholder="ex.: das 9h às 18h" value={d.prazos.horarioAtendimento} onChange={(e) => set("prazos", { horarioAtendimento: e.target.value })} disabled={ro} />
          </Campo>
          <Campo label="Resposta em até (dias úteis)">
            <Input type="number" min="1" value={d.prazos.prazoRespostaDiasUteis} onChange={(e) => set("prazos", { prazoRespostaDiasUteis: inteiro(e.target.value, 1, 1) })} disabled={ro} />
          </Campo>
          <Campo label="Balanço anual em até (dias)">
            <Input type="number" min="1" value={d.prazos.balancoDias} onChange={(e) => set("prazos", { balancoDias: inteiro(e.target.value, 1, 30) })} disabled={ro} />
          </Campo>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Campo label="Início dos serviços">
            <Input type="date" value={d.vigencia.dataInicio} onChange={(e) => set("vigencia", { dataInicio: e.target.value })} disabled={ro} />
          </Campo>
          <Campo label="Aviso prévio (dias)">
            <Input type="number" min="1" value={d.vigencia.avisoPrevioDias} onChange={(e) => set("vigencia", { avisoPrevioDias: inteiro(e.target.value, 1, 60) })} disabled={ro} />
          </Campo>
          <Campo label="Entrega no encerramento (dias úteis)">
            <Input type="number" min="1" value={d.prazos.transicaoDiasUteis} onChange={(e) => set("prazos", { transicaoDiasUteis: inteiro(e.target.value, 1, 10) })} disabled={ro} />
          </Campo>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Foro (comarca/UF)">
            <Input placeholder="ex.: Jundiaí/SP" value={d.vigencia.foro} onChange={(e) => set("vigencia", { foro: e.target.value })} disabled={ro} />
          </Campo>
          <Campo label="Cidade/UF da assinatura (vazio = foro)">
            <Input value={d.assinatura.cidade} onChange={(e) => set("assinatura", { cidade: e.target.value })} disabled={ro} />
          </Campo>
        </div>
        {comAssinatura ? (
          <>
            <Campo label="Data da assinatura (vazio = em branco para preencher)">
              <Input type="date" value={d.assinatura.data} onChange={(e) => set("assinatura", { data: e.target.value })} disabled={ro} />
            </Campo>
            <div className={`grid grid-cols-2 gap-2 ${semTestemunhas ? "hidden" : ""}`}>
              <Campo label="Testemunha 1 — nome">
                <Input value={d.assinatura.testemunha1Nome} onChange={(e) => set("assinatura", { testemunha1Nome: e.target.value })} disabled={ro} />
              </Campo>
              <Campo label="CPF">
                <Input value={d.assinatura.testemunha1Cpf} onChange={(e) => set("assinatura", { testemunha1Cpf: maskCPF(e.target.value) })} disabled={ro} />
              </Campo>
              <Campo label="Testemunha 2 — nome">
                <Input value={d.assinatura.testemunha2Nome} onChange={(e) => set("assinatura", { testemunha2Nome: e.target.value })} disabled={ro} />
              </Campo>
              <Campo label="CPF">
                <Input value={d.assinatura.testemunha2Cpf} onChange={(e) => set("assinatura", { testemunha2Cpf: maskCPF(e.target.value) })} disabled={ro} />
              </Campo>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
