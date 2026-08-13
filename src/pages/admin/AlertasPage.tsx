/**
 * Alertas de vencimento — o cadastro de quem recebe o quê.
 *
 * Três abas, na ordem em que o escritório precisa delas:
 *  1. **Empresas** — a lista, com busca, e o detalhe de cada uma (é onde se trabalha).
 *  2. **Catálogo** — a tabela de obrigações com o vencimento do mês já calculado, para
 *     conferir contra a tabela do escritório sem abrir empresa nenhuma.
 *  3. **O que sai hoje** — a mensagem exata, montada, antes de qualquer envio.
 *
 * A tela não envia nada. Mostrar o texto pronto e deixar o disparo para outro passo é
 * deliberado: dá para revisar a régua inteira com o cliente real na frente, sem risco.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing, FlaskConical, Search, Send, Sparkles, Wand2 } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api, type AlertCompanyRow, type AlertSendResult } from "@/lib/api";

const ESFERA_LABEL: Record<string, string> = {
  federal: "Federal",
  estadual: "Estadual",
  municipal: "Municipal",
  trabalhista: "Trabalhista",
};

function formatarData(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** Detalhe de uma empresa: marcações, sugestões e preferências. */
function DetalheEmpresa({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["alertas", "empresa", companyId],
    queryFn: () => api.alertas.empresa(companyId),
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["alertas", "empresa", companyId] });
    queryClient.invalidateQueries({ queryKey: ["alertas", "panorama"] });
  };

  const decidir = useMutation({
    mutationFn: (v: { codigo: string; ativo: boolean }) =>
      api.alertas.decidir(companyId, v.codigo, v.ativo),
    onSuccess: invalidar,
    onError: (e: Error) => toast.error(e.message),
  });

  const preferencias = useMutation({
    mutationFn: (v: { alertas_ativos?: boolean; incentivo_ativo?: boolean; whatsapp?: string }) =>
      api.alertas.preferencias(companyId, v),
    onSuccess: invalidar,
    onError: (e: Error) => toast.error(e.message),
  });

  const [whatsapp, setWhatsapp] = useState<string | null>(null);

  if (isLoading || !data) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>;
  }

  const { empresa, obrigacoes, sugestoes } = data;

  return (
    <div className="space-y-6">
      {/* Preferências do cliente. O desligamento fica no topo porque é o que o
          escritório vem procurar quando o cliente reclama de mensagem. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Preferências</CardTitle>
          <CardDescription>
            Cliente que não gosta de mensagem: desligue aqui sem perder as marcações.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="alertas-ativos" className="font-normal">
              Recebe alertas de vencimento
            </Label>
            <Switch
              id="alertas-ativos"
              checked={empresa.alertas_ativos}
              onCheckedChange={(v) => preferencias.mutate({ alertas_ativos: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="incentivo-ativo" className="font-normal">
              Aceita a frase sobre o portal no fim do alerta
            </Label>
            <Switch
              id="incentivo-ativo"
              checked={empresa.incentivo_ativo}
              onCheckedChange={(v) => preferencias.mutate({ incentivo_ativo: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label className="font-normal">Aviso de documento novo</Label>
            {/* Só leitura: esta é a decisão do cliente, tomada no portal dele. */}
            <span className="text-xs text-muted-foreground">
              {empresa.avisos_documentos_ativos
                ? "o cliente aceita receber"
                : "o cliente pediu para não receber"}
            </span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="whatsapp">WhatsApp do alerta</Label>
            <div className="flex gap-2">
              <Input
                id="whatsapp"
                inputMode="numeric"
                placeholder="34999998888"
                value={whatsapp ?? empresa.whatsapp_manual ?? ""}
                onChange={(e) => setWhatsapp(e.target.value)}
              />
              <Button
                variant="outline"
                onClick={() => preferencias.mutate({ whatsapp: whatsapp ?? "" })}
                disabled={whatsapp === null || preferencias.isPending}
              >
                Salvar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {sugestoes.length > 0 && (
        <Card className="border-primary/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" />
              O portal encontrou estas obrigações
            </CardTitle>
            <CardDescription>
              Foram vistas nas guias deste cliente, mas ninguém marcou ainda. Marcar é
              decisão sua — uma guia avulsa não prova recolhimento todo mês.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {sugestoes.map((s) => (
              <div
                key={s.codigo}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">{s.nome}</p>
                  <p className="text-xs text-muted-foreground">{s.evidencia}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => decidir.mutate({ codigo: s.codigo, ativo: true })}
                    disabled={decidir.isPending}
                  >
                    Receber alerta
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => decidir.mutate({ codigo: s.codigo, ativo: false })}
                    disabled={decidir.isPending}
                  >
                    Não recolhe
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Obrigações</CardTitle>
          <CardDescription>
            As marcadas como automáticas vieram de uma regra — o motivo aparece ao lado.
            Desmarcar à mão prevalece sobre a regra.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {obrigacoes.map((o) => (
            <label
              key={o.codigo}
              className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted/50"
            >
              <Checkbox
                checked={o.marcada}
                onCheckedChange={(v) => decidir.mutate({ codigo: o.codigo, ativo: Boolean(v) })}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{o.nome}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {ESFERA_LABEL[o.esfera] ?? o.esfera}
                  </Badge>
                  {o.origem === "auto" && (
                    <Badge variant="secondary" className="text-[10px]">
                      automática
                    </Badge>
                  )}
                  {o.avisar_dias_antes === 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      avisa no próprio dia
                    </Badge>
                  )}
                </span>
                {o.observacao && (
                  <span className="block text-xs text-muted-foreground">{o.observacao}</span>
                )}
              </span>
            </label>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="outline" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </div>
  );
}

/**
 * Campo de WhatsApp editável na própria lista.
 *
 * Salva ao sair do campo, e só quando mudou. O servidor recusa fixo e número torto com
 * motivo próprio, e é esse motivo que aparece no toast — o admin corrige o cadastro na
 * hora, em vez de descobrir semanas depois que aquele cliente nunca recebeu nada.
 */
function WhatsappInline({ company }: { company: AlertCompanyRow }) {
  const queryClient = useQueryClient();
  // O campo edita a EXCEÇÃO manual. Vazio com o número do G-Click de marca-d'água
  // significa "usando o cadastro do G-Click" — que é o normal e o desejável. Mostrar o
  // número do espelho dentro do campo faria parecer que ele foi digitado aqui, e o
  // primeiro salvamento congelaria uma cópia que nunca mais acompanharia o cadastro.
  const [valor, setValor] = useState(company.whatsapp_manual ?? "");

  const salvar = useMutation({
    mutationFn: (v: string) => api.alertas.preferencias(company.id, { whatsapp: v }),
    onSuccess: (r) => {
      setValor(r.whatsapp ?? "");
      toast.success(`WhatsApp de ${company.name} salvo.`);
      queryClient.invalidateQueries({ queryKey: ["alertas", "panorama"] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setValor(company.whatsapp_manual ?? "");
    },
  });

  return (
    <Input
      className={`h-8 w-44 text-xs ${!company.whatsapp ? "border-amber-500/60" : ""}`}
      placeholder={company.whatsapp_gclick ? `${company.whatsapp_gclick} (G-Click)` : "Sem WhatsApp"}
      title={
        company.whatsapp_manual
          ? "Número manual — sobrepõe o cadastro do G-Click"
          : "Vazio = usa o número do cadastro do G-Click"
      }
      inputMode="numeric"
      value={valor}
      onChange={(e) => setValor(e.target.value)}
      onBlur={() => {
        if (valor.trim() === (company.whatsapp_manual ?? "")) return;
        salvar.mutate(valor.trim());
      }}
      disabled={salvar.isPending}
    />
  );
}

const AlertasPage = () => {
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);

  const panorama = useQuery({
    queryKey: ["alertas", "panorama"],
    queryFn: () => api.alertas.panorama(),
  });

  const catalogo = useQuery({
    queryKey: ["alertas", "catalogo"],
    queryFn: () => api.alertas.catalogo(),
  });

  // A API sempre aceitou uma data; faltava a tela deixar escolher. Ver a semana à frente
  // é o que permite conferir a régua sem esperar o dia chegar.
  const [dataPrevisao, setDataPrevisao] = useState("");

  const previsao = useQuery({
    queryKey: ["alertas", "previsao", dataPrevisao],
    queryFn: () => api.alertas.previsao(dataPrevisao || undefined),
  });

  const whatsapp = useQuery({
    queryKey: ["alertas", "whatsapp"],
    queryFn: () => api.alertas.whatsapp(),
  });

  const config = useQuery({
    queryKey: ["alertas", "config"],
    queryFn: () => api.alertas.config(),
  });

  const salvarConfig = useMutation({
    mutationFn: (
      v: Partial<{
        envio_automatico: boolean;
        hora: number;
        escritorio_cnpj: string;
        boleto_dias_antes: number;
        boleto_cobranca_dias: number[];
      }>
    ) => api.alertas.salvarConfig(v),
    onSuccess: () => {
      toast.success("Configuração salva.");
      queryClient.invalidateQueries({ queryKey: ["alertas", "config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retidos = useQuery({
    queryKey: ["alertas", "retidos"],
    queryFn: () => api.alertas.retidos(7),
  });

  const [soSemWhatsapp, setSoSemWhatsapp] = useState(false);
  const [confirmarEnvio, setConfirmarEnvio] = useState(false);
  // Quem recebe é escolha da tela, não de variável de ambiente. Vazio = todos da previsão.
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [resultado, setResultado] = useState<AlertSendResult | null>(null);

  // Envio de teste (isolado): não mexe na trava do dia nem no fluxo automático.
  const [testeEmpresa, setTesteEmpresa] = useState("");
  const [testeResult, setTesteResult] = useState<
    { ok: boolean; numero?: string | null; texto?: string; erro?: string } | null
  >(null);
  const enviarTeste = useMutation({
    mutationFn: (tipo: "documentos" | "boleto_em_dia" | "boleto_vencido") =>
      api.alertas.enviarTeste(testeEmpresa, tipo),
    onSuccess: (r) => {
      setTesteResult(r);
      if (r.ok) toast.success(`Teste enviado para ${r.numero}.`);
      else toast.error(r.erro || "Falha no envio de teste.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const enviar = useMutation({
    mutationFn: (v: { simular: boolean }) =>
      api.alertas.enviar({
        simular: v.simular,
        companyIds: selecionadas.size ? [...selecionadas] : undefined,
      }),
    onSuccess: (r) => {
      setResultado(r);
      if (r.erro) toast.error(r.erro);
      else if (r.simulado) toast.success("Ensaio pronto — nada foi enviado.");
      else toast.success(`${r.enviados} alerta(s) enviado(s).`);
      queryClient.invalidateQueries({ queryKey: ["alertas", "previsao"] });
      queryClient.invalidateQueries({ queryKey: ["alertas", "panorama"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const automaticas = useMutation({
    mutationFn: () => api.alertas.aplicarAutomaticas(),
    onSuccess: (r) => {
      toast.success(
        r.marcacoes_criadas === 0
          ? "Nada a marcar: a carteira já está em dia."
          : `${r.marcacoes_criadas} marcação(ões) criada(s) em ${r.empresas} empresa(s).`
      );
      queryClient.invalidateQueries({ queryKey: ["alertas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const termo = busca.trim().toLowerCase();
  const empresas = (panorama.data?.empresas ?? []).filter((c) => {
    if (soSemWhatsapp && c.whatsapp) return false;
    if (!termo) return true;
    return (
      c.name.toLowerCase().includes(termo) ||
      c.cnpj.replace(/\D/g, "").includes(termo.replace(/\D/g, ""))
    );
  });

  /** Sem WhatsApp o alerta não tem para onde ir — daí o botão de enviar ficar travado. */
  const motivoEnvioTravado = !whatsapp.data?.ok
    ? (whatsapp.data?.mensagem ?? "Verificando a conexão do WhatsApp…")
    : (previsao.data?.total ?? 0) === 0
      ? "Não há nenhum vencimento com alerta para esta data."
      : null;

  return (
    <AdminLayout
      title="Alertas de vencimento"
      description="Quais obrigações cada cliente recebe, e o texto que chega no WhatsApp dele"
    >
      <Tabs defaultValue="empresas" className="space-y-4">
        <TabsList>
          <TabsTrigger value="empresas">Empresas</TabsTrigger>
          <TabsTrigger value="catalogo">Catálogo</TabsTrigger>
          <TabsTrigger value="hoje">O que sai hoje</TabsTrigger>
        </TabsList>

        <TabsContent value="empresas" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              { label: "Empresas", valor: panorama.data?.total ?? 0 },
              { label: "Sem obrigação marcada", valor: panorama.data?.sem_marcacao ?? 0 },
              { label: "Sem WhatsApp", valor: panorama.data?.sem_whatsapp ?? 0 },
              { label: "Alertas desligados", valor: panorama.data?.desligadas ?? 0 },
              {
                label: "Recusaram aviso de documento",
                valor: panorama.data?.recusaram_documentos ?? 0,
              },
            ].map((c) => (
              <Card key={c.label}>
                <CardContent className="p-4">
                  <p className="text-2xl font-bold">{c.valor}</p>
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Buscar por nome ou CNPJ…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <Button
              variant={soSemWhatsapp ? "default" : "outline"}
              onClick={() => setSoSemWhatsapp((v) => !v)}
            >
              Só sem WhatsApp
            </Button>
            <Button
              variant="outline"
              onClick={() => automaticas.mutate()}
              disabled={automaticas.isPending}
            >
              <Wand2 className="mr-2 h-4 w-4" />
              Aplicar marcações automáticas
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {panorama.isLoading ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Carregando…</p>
              ) : empresas.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Nenhuma empresa encontrada.
                </p>
              ) : (
                <ul className="divide-y">
                  {empresas.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 p-3">
                      <button
                        className="min-w-0 flex-1 text-left hover:underline"
                        onClick={() => setAberta(c.id)}
                      >
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {c.cnpj} · último alerta: {formatarData(c.ultimo_alerta_em)}
                        </span>
                      </button>
                      {/* WhatsApp direto na lista: preencher 60 empresas abrindo um
                          diálogo por vez é o tipo de trabalho que ninguém termina. */}
                      <WhatsappInline company={c} />
                      <span className="flex items-center gap-2">
                        {!c.alertas_ativos && <Badge variant="outline">desligado</Badge>}
                        {/* Vontade do cliente, não configuração do escritório. */}
                        {!c.avisos_documentos_ativos && (
                          <Badge variant="outline" title="O cliente pediu no portal">
                            recusou avisos
                          </Badge>
                        )}
                        {c.ferias_dispensadas > 0 && (
                          <Badge variant="outline">{c.ferias_dispensadas} férias dispensadas</Badge>
                        )}
                        <Badge variant={c.marcadas ? "secondary" : "outline"}>
                          {c.marcadas} obrigação(ões)
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="catalogo">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Vencimentos de {catalogo.data?.referencia ?? "—"}
              </CardTitle>
              <CardDescription>
                Só as obrigações <span className="font-medium">automáticas</span> — as que o sistema aplica
                sozinho aos clientes (Simples Nacional). Calculado na hora, com feriados nacionais e a regra
                de cada tributo. Data nunca é gravada: se o calendário mudar, esta tabela muda junto.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {(catalogo.data?.obrigacoes ?? []).filter((o) => o.automatica).map((o) => (
                <div
                  key={o.codigo}
                  className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {o.nome}
                      <Badge variant="outline" className="text-[10px]">
                        {ESFERA_LABEL[o.esfera] ?? o.esfera}
                      </Badge>
                      {o.automatica && (
                        <Badge variant="secondary" className="text-[10px]">
                          automática
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{o.regra}</p>
                    {o.observacao && (
                      <p className="text-xs text-amber-600 dark:text-amber-500">{o.observacao}</p>
                    )}
                  </div>
                  <span className="font-mono text-sm">{formatarData(o.vencimento_no_mes)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hoje" className="space-y-4">
          {/* Configuração operacional na TELA. Antes era variável de ambiente, o que
              cobrava um redeploy por decisão e ainda tinha um modo de falha silencioso:
              variável não repassada pelo compose simplesmente não chegava. */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Configuração</CardTitle>
              <CardDescription>
                Vale na hora — o agendador relê a cada 15 minutos, sem redeploy.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3">
                <Switch
                  id="envio-automatico"
                  checked={Boolean(config.data?.envio_automatico)}
                  disabled={salvarConfig.isPending}
                  onCheckedChange={(v) => salvarConfig.mutate({ envio_automatico: v })}
                />
                <Label htmlFor="envio-automatico" className="font-normal">
                  Envio automático diário
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="hora-envio" className="font-normal text-sm">
                  às
                </Label>
                <Input
                  id="hora-envio"
                  type="number"
                  min={0}
                  max={23}
                  className="h-9 w-20"
                  defaultValue={config.data?.hora ?? 8}
                  onBlur={(e) => {
                    const h = Number(e.target.value);
                    if (Number.isInteger(h) && h >= 0 && h <= 23 && h !== config.data?.hora) {
                      salvarConfig.mutate({ hora: h });
                    }
                  }}
                />
                <span className="text-sm text-muted-foreground">h (São Paulo)</span>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="escritorio-cnpj" className="font-normal text-sm">
                  CNPJ do escritório
                </Label>
                <Input
                  id="escritorio-cnpj"
                  className="h-9 w-48"
                  placeholder="só dígitos"
                  defaultValue={config.data?.escritorio_cnpj ?? ""}
                  onBlur={(e) => {
                    const v = e.target.value.replace(/\D/g, "");
                    if (v !== (config.data?.escritorio_cnpj ?? "")) {
                      salvarConfig.mutate({ escritorio_cnpj: v });
                    }
                  }}
                />
              </div>

              {/* Cadência de cobrança do BOLETO (Cora). Antes só existia em variável de
                  ambiente — agora é ajustável aqui. */}
              <div className="border-t pt-4 space-y-3">
                <p className="text-sm font-medium">Cobrança de boleto (Cora)</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor="boleto-dias-antes" className="font-normal text-sm">
                    Lembrete
                  </Label>
                  <Input
                    id="boleto-dias-antes"
                    type="number"
                    min={0}
                    max={30}
                    className="h-9 w-20"
                    defaultValue={config.data?.boleto_dias_antes ?? 1}
                    onBlur={(e) => {
                      const d = Number(e.target.value);
                      if (Number.isInteger(d) && d >= 0 && d <= 30 && d !== config.data?.boleto_dias_antes) {
                        salvarConfig.mutate({ boleto_dias_antes: d });
                      }
                    }}
                  />
                  <span className="text-sm text-muted-foreground">dia(s) antes do vencimento (0 = sem lembrete)</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor="boleto-cobranca-dias" className="font-normal text-sm">
                    Cobrar o vencido em
                  </Label>
                  <Input
                    id="boleto-cobranca-dias"
                    className="h-9 w-40"
                    placeholder="3, 10, 30"
                    defaultValue={(config.data?.boleto_cobranca_dias ?? []).join(", ")}
                    onBlur={(e) => {
                      const dias = Array.from(
                        new Set(
                          e.target.value
                            .split(",")
                            .map((s) => parseInt(s.trim(), 10))
                            .filter((n) => Number.isInteger(n) && n >= 1 && n <= 90)
                        )
                      ).sort((a, b) => a - b);
                      const atual = config.data?.boleto_cobranca_dias ?? [];
                      if (dias.join(",") !== atual.join(",")) {
                        salvarConfig.mutate({ boleto_cobranca_dias: dias });
                      }
                    }}
                  />
                  <span className="text-sm text-muted-foreground">dia(s) após o vencimento (vazio = não cobrar)</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Antes de qualquer coisa: o que vai ser cobrado e ainda não está no ar.
              Liberar aqui evita o cliente receber o aviso e achar o portal vazio. */}
          {(retidos.data?.total ?? 0) > 0 && (
            <Card className="border-amber-500/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {retidos.data?.total} guia(s) vencem em 7 dias e ainda estão retidas
                </CardTitle>
                <CardDescription>
                  {retidos.data?.vence_amanha
                    ? `${retidos.data.vence_amanha} vence(m) amanhã — o alerta sai hoje e o cliente não vai encontrar o documento.`
                    : "O cliente ainda não consegue ver estes documentos."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                {retidos.data?.itens.slice(0, 12).map((g) => (
                  <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 text-sm last:border-0">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{g.empresa}</span>{" "}
                      <span className="text-muted-foreground">· {g.title}</span>
                    </span>
                    <Badge variant="outline">{formatarData(g.due_date)}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    whatsapp.data?.ok ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
                <div>
                  <p className="text-sm font-medium">WhatsApp</p>
                  <p className="text-xs text-muted-foreground">
                    {whatsapp.isLoading ? "Verificando…" : (whatsapp.data?.mensagem ?? "—")}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  className="h-9 w-auto"
                  value={dataPrevisao}
                  onChange={(e) => setDataPrevisao(e.target.value)}
                  title="Ver o que sairia noutro dia"
                />
                {dataPrevisao && (
                  <Button variant="ghost" size="sm" onClick={() => setDataPrevisao("")}>
                    Hoje
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => enviar.mutate({ simular: true })}
                  disabled={enviar.isPending}
                >
                  Ensaiar (não envia)
                </Button>
                <Button
                  onClick={() => setConfirmarEnvio(true)}
                  disabled={enviar.isPending || Boolean(motivoEnvioTravado)}
                  // Botão desabilitado sem explicação vira chamado de suporte.
                  title={motivoEnvioTravado ?? "Enviar os alertas de hoje"}
                >
                  <Send className="mr-2 h-4 w-4" />
                  {selecionadas.size ? `Enviar aos ${selecionadas.size} marcados` : "Enviar a todos"}
                </Button>
                {selecionadas.size > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setSelecionadas(new Set())}>
                    Limpar seleção
                  </Button>
                )}
              </div>
              {motivoEnvioTravado && (
                <p className="w-full text-xs text-muted-foreground">{motivoEnvioTravado}</p>
              )}
            </CardContent>
          </Card>

          {/* Envio de teste isolado — depurar o recebimento sem esperar um vencimento
              real e sem consumir a trava do dia (o automático segue intacto). */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FlaskConical className="h-4 w-4" /> Enviar teste
              </CardTitle>
              <CardDescription>
                Manda uma mensagem real ao número da empresa (o mesmo do envio: manual, ou o do G-Click
                se o manual estiver vazio) para você conferir o recebimento. Vem marcada como TESTE e
                <span className="font-medium"> não consome a trava do dia</span> — o envio automático continua igual.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={testeEmpresa}
                  onChange={(e) => {
                    setTesteEmpresa(e.target.value);
                    setTesteResult(null);
                  }}
                >
                  <option value="">Escolha a empresa…</option>
                  {(panorama.data?.empresas ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!testeEmpresa || enviarTeste.isPending}
                  onClick={() => enviarTeste.mutate("documentos")}
                >
                  Há documentos no portal
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!testeEmpresa || enviarTeste.isPending}
                  onClick={() => enviarTeste.mutate("boleto_em_dia")}
                >
                  Boleto em dia
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!testeEmpresa || enviarTeste.isPending}
                  onClick={() => enviarTeste.mutate("boleto_vencido")}
                >
                  Boleto vencido
                </Button>
              </div>
              {testeResult &&
                (testeResult.ok ? (
                  <div className="rounded-md border p-3">
                    <p className="text-sm text-emerald-600">Enviado para {testeResult.numero}.</p>
                    <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">
                      {testeResult.texto}
                    </pre>
                  </div>
                ) : (
                  <p className="text-sm text-red-600">{testeResult.erro}</p>
                ))}
            </CardContent>
          </Card>

          {resultado && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {resultado.simulado ? "Ensaio" : "Envio"} de {formatarData(resultado.dia)}
                </CardTitle>
                <CardDescription>
                  {resultado.erro
                    ? resultado.erro
                    : resultado.simulado
                      ? `${resultado.resultados.filter((r) => r.status === "sairia").length} sairia(m), ${resultado.ignorados} ficaria(m) de fora.`
                      : `${resultado.enviados} enviado(s), ${resultado.falhas} falha(s), ${resultado.ignorados} ignorado(s).`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                {resultado.resultados.map((r, i) => (
                  <div key={`${r.company_id ?? "geral"}-${i}`} className="flex flex-wrap items-center gap-2 border-b py-1.5 text-sm last:border-0">
                    <Badge
                      variant={
                        r.status === "enviado" || r.status === "sairia" ? "default" : "outline"
                      }
                      className="text-[10px]"
                    >
                      {r.status}
                    </Badge>
                    <span className="font-medium">{r.empresa ?? "—"}</span>
                    {r.motivo && <span className="text-xs text-muted-foreground">{r.motivo}</span>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BellRing className="h-4 w-4" />
                {previsao.data?.total ?? 0} mensagem(ns) para {formatarData(previsao.data?.data ?? null)}
              </CardTitle>
              <CardDescription>
                O texto exato que o cliente receberia. Abrir esta aba não envia nada.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {previsao.isLoading ? (
                <p className="text-center text-sm text-muted-foreground">Carregando…</p>
              ) : (previsao.data?.mensagens.length ?? 0) === 0 ? (
                <p className="text-center text-sm text-muted-foreground">
                  Nenhum vencimento com alerta para hoje.
                </p>
              ) : (
                previsao.data?.mensagens.map((m) => (
                  <div key={m.company_id} className="rounded-md border p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <label className="flex min-w-0 items-center gap-2">
                        {/* Escolher quem recebe é operação: um piloto é marcar um
                            cliente e enviar, sem configurar nada no ambiente. */}
                        <Checkbox
                          checked={selecionadas.has(m.company_id)}
                          onCheckedChange={(v) =>
                            setSelecionadas((prev) => {
                              const p = new Set(prev);
                              if (v) p.add(m.company_id);
                              else p.delete(m.company_id);
                              return p;
                            })
                          }
                        />
                        <span className="truncate font-medium">{m.empresa}</span>
                      </label>
                      <span className="flex items-center gap-2">
                        {!m.whatsapp && <Badge variant="outline">sem WhatsApp</Badge>}
                        <Badge variant="secondary">vence {formatarData(m.vencimento)}</Badge>
                      </span>
                    </div>
                    <pre className="whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">
                      {m.texto}
                    </pre>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(aberta)} onOpenChange={(o) => !o && setAberta(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Alertas da empresa</DialogTitle>
            <DialogDescription>
              Marque o que este cliente recolhe. O que estiver marcado vira alerta na
              véspera do vencimento.
            </DialogDescription>
          </DialogHeader>
          {aberta && <DetalheEmpresa companyId={aberta} onClose={() => setAberta(null)} />}
        </DialogContent>
      </Dialog>

      {/* Envio de verdade pede confirmação: chega no celular do cliente e não desfaz. */}
      <AlertDialog open={confirmarEnvio} onOpenChange={setConfirmarEnvio}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Enviar {previsao.data?.total ?? 0} mensagem(ns) agora?
            </AlertDialogTitle>
            <AlertDialogDescription>
              As mensagens chegam no WhatsApp dos clientes imediatamente e não têm como
              ser desfeitas. Se ainda não conferiu o texto, use antes o ensaio.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => enviar.mutate({ simular: false })}>
              Enviar agora
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
};

export default AlertasPage;
