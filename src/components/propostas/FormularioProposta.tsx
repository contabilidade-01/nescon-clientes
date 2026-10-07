/**
 * Abas do editor de proposta: Cliente, Serviços e Condições. Tudo o que o assistente preenche
 * também dá para ajustar aqui, à mão.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Campo } from "@/components/contratos/FormularioContrato";
import {
  COMPLEXIDADE_LABEL,
  ENQUADRAMENTO_LABEL,
  TIPO_LABEL,
  brl,
  type Complexidade,
  type Enquadramento,
  type TipoEmpresa,
} from "@/lib/contratoModelo";
import { num } from "@/lib/inputNum";
import {
  GRUPO_LABEL,
  MODO_LABEL,
  calcularItem,
  type CatalogoProposta,
  type GrupoServico,
  type ItemProposta,
  type ModoCobranca,
  type PropostaDados,
} from "@/lib/propostaModelo";

export type SetProposta = (fn: (d: PropostaDados) => PropostaDados) => void;

function Numero({
  value,
  onChange,
  step = "any",
  placeholder,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  step?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      step={step}
      min={0}
      disabled={disabled}
      placeholder={placeholder ?? "0"}
      value={value === 0 ? "" : value}
      onChange={(e) => onChange(Math.max(0, num(e.target.value, 0)))}
    />
  );
}

function linhas(texto: string): string[] {
  return texto.split("\n").map((l) => l.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------
export function AbaCliente({
  d,
  set,
  empresas,
  companyId,
  onEmpresa,
}: {
  d: PropostaDados;
  set: SetProposta;
  empresas: Array<{ id: string; name: string; cnpj: string }>;
  companyId: string;
  onEmpresa: (id: string) => void;
}) {
  const c = d.cliente;
  const setC = (patch: Partial<PropostaDados["cliente"]>) => set((x) => ({ ...x, cliente: { ...x.cliente, ...patch } }));
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Quem recebe</CardTitle>
          <CardDescription>Cliente do portal (preenche sozinho) ou prospecto novo — é só digitar o nome.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Campo label="Cliente do portal (opcional)" className="sm:col-span-2">
            <Select value={companyId || "none"} onValueChange={(v) => onEmpresa(v === "none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Prospecto (não é cliente ainda)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Prospecto (não é cliente ainda)</SelectItem>
                {empresas.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Nome / razão social" className="sm:col-span-2">
            <Input value={c.nome} onChange={(e) => setC({ nome: e.target.value })} />
          </Campo>
          <Campo label="CNPJ / CPF">
            <Input value={c.cnpj} onChange={(e) => setC({ cnpj: e.target.value })} />
          </Campo>
          <Campo label="Tratamento">
            <Select value={c.tratamento || "none"} onValueChange={(v) => setC({ tratamento: v === "none" ? "" : v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">(sem tratamento)</SelectItem>
                <SelectItem value="Sr.">Sr.</SelectItem>
                <SelectItem value="Sra.">Sra.</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Quem assina / recebe (pessoa)">
            <Input value={c.contato} onChange={(e) => setC({ contato: e.target.value })} />
          </Campo>
          <Campo label="E-mail">
            <Input type="email" value={c.email} onChange={(e) => setC({ email: e.target.value })} />
          </Campo>
          <Campo label="Telefone / WhatsApp">
            <Input value={c.telefone} onChange={(e) => setC({ telefone: e.target.value })} />
          </Campo>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Perfil e situação</CardTitle>
          <CardDescription>Definem o valor da mensalidade pela tabela e os funcionários excedentes.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Campo label="Enquadramento">
            <Select value={c.enquadramento} onValueChange={(v) => setC({ enquadramento: v as Enquadramento })}>
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
          <Campo label="Atividade">
            <Select value={c.tipoEmpresa} onValueChange={(v) => setC({ tipoEmpresa: v as TipoEmpresa })}>
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
            <Select value={c.complexidade} onValueChange={(v) => setC({ complexidade: v as Complexidade })}>
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
          <Campo label="Funcionários (com pró-labore)">
            <Numero value={c.funcionarios} step="1" onChange={(n) => setC({ funcionarios: Math.floor(n) })} />
          </Campo>
          <Campo label="Situação em uma frase (aparece na proposta)" className="sm:col-span-2">
            <Textarea rows={2} value={c.situacao} onChange={(e) => setC({ situacao: e.target.value })} placeholder="Ex.: MEI com DASN de 2022 a 2024 em atraso e R$ 8 mil em DAS vencidos." />
          </Campo>
          <Campo label="Assunto da proposta (vazio = automático)" className="sm:col-span-2">
            <Input
              value={d.cabecalho.assunto}
              onChange={(e) => set((x) => ({ ...x, cabecalho: { ...x.cabecalho, assunto: e.target.value } }))}
              placeholder="Ex.: regularização de MEI e assessoria mensal"
            />
          </Campo>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Serviços
// ---------------------------------------------------------------------------
function LinhaItem({ i, d, set }: { i: ItemProposta; d: PropostaDados; set: SetProposta }) {
  const [aberto, setAberto] = useState(false);
  const c = calcularItem(i, d.condicoes);
  const up = (patch: Partial<ItemProposta>) => set((x) => ({ ...x, itens: x.itens.map((k) => (k.uid === i.uid ? { ...k, ...patch } : k)) }));
  const rotuloQtd = i.modo === "retroativo" ? "Meses" : i.modo === "mensal" ? "Qtd/mês" : "Qtd";

  return (
    <div className={`rounded-md border p-3 ${i.ativo ? "" : "bg-muted/40 opacity-70"}`}>
      <div className="flex items-start gap-2">
        <Checkbox checked={i.ativo} onCheckedChange={(v) => up({ ativo: v === true })} className="mt-2" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Input value={i.titulo} onChange={(e) => up({ titulo: e.target.value })} className="font-medium" />
            <Button variant="ghost" size="icon" title="Remover" onClick={() => set((x) => ({ ...x, itens: x.itens.filter((k) => k.uid !== i.uid) }))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Campo label="Cobrança">
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
            </Campo>
            {i.modo === "percentual" ? (
              <>
                <Campo label="Valor da dívida (R$)">
                  <Numero value={i.base} onChange={(n) => up({ base: n })} />
                </Campo>
                <Campo label="% cobrado">
                  <Numero value={i.percentual} onChange={(n) => up({ percentual: Math.min(100, n) })} />
                </Campo>
                <Campo label="Mínimo (R$)">
                  <Numero value={i.minimo} onChange={(n) => up({ minimo: n })} />
                </Campo>
              </>
            ) : i.modo === "sob_consulta" ? null : (
              <>
                <Campo label={`Valor por ${i.unidade || "unidade"} (R$)`}>
                  <Numero value={i.valorUnit} onChange={(n) => up({ valorUnit: n, manual: true })} />
                </Campo>
                <Campo label={rotuloQtd}>
                  <Numero value={i.quantidade} step="1" onChange={(n) => up({ quantidade: Math.floor(n) })} />
                </Campo>
                <div className="flex items-end pb-2 text-sm font-semibold">
                  {c.mensal != null ? `${brl(c.mensal)}/mês` : c.total != null ? brl(c.total) : ""}
                </div>
              </>
            )}
          </div>
          {i.modo === "percentual" && c.total != null ? <p className="text-sm font-semibold">Honorário: {brl(c.total)}</p> : null}
          <p className="text-xs text-muted-foreground">
            {c.pagamento}
            {i.auto ? " · gerado automaticamente pelos funcionários informados" : ""}
            {i.tabelaBase && !i.manual ? " · valor da tabela (tipo × complexidade)" : ""}
          </p>

          <button type="button" onClick={() => setAberto((a) => !a)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Pagamento, prazo e textos
          </button>
          {aberto ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {i.modo === "unico" ? (
                <>
                  <Campo label="Entrada na contratação (%) — 0 = sem entrada">
                    <Numero value={i.entradaPct} onChange={(n) => up({ entradaPct: Math.min(100, n) })} />
                  </Campo>
                  <Campo label="Saldo pago">
                    <Input value={i.saldoQuando} onChange={(e) => up({ saldoQuando: e.target.value })} placeholder="ao final do processo" />
                  </Campo>
                  <Campo label="Parcelas (sem entrada)">
                    <Numero value={i.parcelas} step="1" placeholder="1" onChange={(n) => up({ parcelas: Math.max(1, Math.floor(n)) })} />
                  </Campo>
                </>
              ) : null}
              <Campo label="Prazo">
                <Input value={i.prazo} onChange={(e) => up({ prazo: e.target.value })} />
              </Campo>
              <Campo label="Forma de pagamento (substitui o texto automático)" className="sm:col-span-2">
                <Input value={i.pagamento} onChange={(e) => up({ pagamento: e.target.value })} />
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

export function AbaServicos({
  d,
  set,
  catalogo,
  onPacote,
  onItem,
}: {
  d: PropostaDados;
  set: SetProposta;
  catalogo: CatalogoProposta;
  onPacote: (id: string) => void;
  onItem: (codigo: string) => void;
}) {
  const grupos = (Object.keys(GRUPO_LABEL) as GrupoServico[])
    .map((g) => ({ g, itens: catalogo.itens.filter((i) => i.habilitado && i.grupo === g) }))
    .filter((x) => x.itens.length);
  const pacotesAplicados = catalogo.pacotes.filter((p) => d.pacotes.includes(p.id));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cenários prontos</CardTitle>
          <CardDescription>Um clique traz os serviços do cenário; depois é só ajustar quantidades.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {catalogo.pacotes
            .filter((p) => p.habilitado)
            .map((p) => (
              <Button key={p.id} size="sm" variant={d.pacotes.includes(p.id) ? "secondary" : "outline"} title={p.descricao} onClick={() => onPacote(p.id)}>
                {p.nome}
              </Button>
            ))}
        </CardContent>
      </Card>

      {pacotesAplicados.some((p) => p.perguntas.length) ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">O que perguntar ao cliente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {pacotesAplicados.map((p) => (
              <div key={p.id}>
                <div className="mb-1 font-medium">{p.nome}</div>
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {p.perguntas.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-2">
        {d.itens.length ? (
          d.itens.map((i) => <LinhaItem key={i.uid} i={i} d={d} set={set} />)
        ) : (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nenhum serviço ainda. Escolha um cenário acima, peça ao assistente ou adicione abaixo.
          </div>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 pt-4">
          <Plus className="h-4 w-4 text-muted-foreground" />
          <Select value="" onValueChange={(v) => v && onItem(v)}>
            <SelectTrigger className="w-full sm:w-[360px]">
              <SelectValue placeholder="Adicionar serviço do catálogo…" />
            </SelectTrigger>
            <SelectContent>
              {grupos.map(({ g, itens }) => (
                <div key={g}>
                  <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">{GRUPO_LABEL[g]}</div>
                  {itens.map((i) => (
                    <SelectItem key={i.codigo} value={i.codigo}>
                      {i.titulo}
                    </SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="secondary">{d.itens.filter((i) => i.ativo).length} no documento</Badge>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Condições
// ---------------------------------------------------------------------------
export function AbaCondicoes({ d, set }: { d: PropostaDados; set: SetProposta }) {
  const cd = d.condicoes;
  const setCd = (patch: Partial<PropostaDados["condicoes"]>) => set((x) => ({ ...x, condicoes: { ...x.condicoes, ...patch } }));
  const setCab = (patch: Partial<PropostaDados["cabecalho"]>) => set((x) => ({ ...x, cabecalho: { ...x.cabecalho, ...patch } }));
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pagamento e mensalidade</CardTitle>
          <CardDescription>Vêm dos padrões do escritório (aba Catálogo e padrões); ajuste só nesta proposta se precisar.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Campo label="Vencimento da mensalidade (dia)">
            <Numero value={cd.vencimentoDia} step="1" onChange={(n) => setCd({ vencimentoDia: Math.min(31, Math.max(1, Math.floor(n))) })} />
          </Campo>
          <Campo label="Forma de pagamento">
            <Input value={cd.formaPagamento} onChange={(e) => setCd({ formaPagamento: e.target.value })} />
          </Campo>
          <Campo label="Chave PIX (pagamentos pontuais)" className="sm:col-span-2">
            <Input value={cd.chavePix} onChange={(e) => setCd({ chavePix: e.target.value })} />
          </Campo>
          <Campo label="Funcionários incluídos na mensalidade">
            <Numero value={cd.funcionariosIncluidos} step="1" onChange={(n) => setCd({ funcionariosIncluidos: Math.floor(n) })} />
          </Campo>
          <Campo label="Valor do funcionário adicional (R$/mês)">
            <Numero value={cd.valorFuncionarioExtra} onChange={(n) => setCd({ valorFuncionarioExtra: n })} />
          </Campo>
          <Campo label="Guias enviadas com antecedência (dias)">
            <Numero value={cd.guiasAntecedenciaDias} step="1" onChange={(n) => setCd({ guiasAntecedenciaDias: Math.floor(n) })} />
          </Campo>
          <Campo label="Reajuste (texto, opcional)">
            <Input value={cd.reajuste} onChange={(e) => setCd({ reajuste: e.target.value })} placeholder="Ex.: pela inflação (IPCA) a partir de janeiro de 2028" />
          </Campo>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Documento</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Campo label="Cidade">
            <Input value={d.cabecalho.cidade} onChange={(e) => setCab({ cidade: e.target.value })} />
          </Campo>
          <Campo label="Data">
            <Input type="date" value={d.cabecalho.data} onChange={(e) => setCab({ data: e.target.value })} />
          </Campo>
          <Campo label="Validade (dias)">
            <Numero value={d.cabecalho.validadeDias} step="1" onChange={(n) => setCab({ validadeDias: Math.max(1, Math.floor(n)) })} />
          </Campo>
          <Campo label="Assina pela Nescon">
            <Input value={d.assinatura.nome} onChange={(e) => set((x) => ({ ...x, assinatura: { ...x.assinatura, nome: e.target.value } }))} />
          </Campo>
          <Campo label="Cargo">
            <Input value={d.assinatura.cargo} onChange={(e) => set((x) => ({ ...x, assinatura: { ...x.assinatura, cargo: e.target.value } }))} />
          </Campo>
          <Campo label="Texto de abertura (vazio = padrão)" className="sm:col-span-2">
            <Textarea rows={3} value={d.cabecalho.introducao} onChange={(e) => setCab({ introducao: e.target.value })} />
          </Campo>
          <Campo label="Observações extras nas condições (uma por linha)" className="sm:col-span-2">
            <Textarea rows={3} value={cd.observacoes.join("\n")} onChange={(e) => setCd({ observacoes: linhas(e.target.value) })} />
          </Campo>
        </CardContent>
      </Card>
    </div>
  );
}
