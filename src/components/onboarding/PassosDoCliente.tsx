import { useRef, useState } from "react";
import { CalendarClock, CheckCircle2, Flag, Headphones, Loader2, Repeat, UploadCloud, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dataBR, type OnboardingCliente, type OnboardingItem } from "@/lib/onboardingModelo";

/**
 * Primeiros passos do cliente novo: o que enviar, até quando, por onde, e o envio dos arquivos
 * item a item. Usado pelo link público (sem login) e pelo portal logado: a mesma tela nas duas.
 */
function ItemDocumento({ item, onEnviar, enviando }: { item: OnboardingItem; onEnviar: (files: File[]) => void; enviando: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);
  const aprovado = item.envio?.status === "aprovado";
  const reprovado = item.envio?.status === "reprovado";
  const enviado = item.envio?.status === "enviado";

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${arrastando ? "border-primary bg-primary/5" : ""}`}
      onDragOver={(e) => {
        if (aprovado) return;
        e.preventDefault();
        setArrastando(true);
      }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => {
        e.preventDefault();
        setArrastando(false);
        if (!aprovado && e.dataTransfer.files.length) onEnviar(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {item.titulo}
            {!item.obrigatorio && <span className="ml-2 text-xs font-normal text-muted-foreground">(opcional)</span>}
          </p>
          {item.descricao && <p className="mt-1 text-sm text-muted-foreground">{item.descricao}</p>}
        </div>
        {aprovado && (
          <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Aprovado
          </Badge>
        )}
        {enviado && <Badge variant="secondary">Recebido — em análise</Badge>}
        {reprovado && (
          <Badge variant="destructive">
            <XCircle className="mr-1 h-3 w-3" /> Reenviar
          </Badge>
        )}
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {item.prazoData && (
          <div className="flex items-center gap-1.5">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            <dt className="sr-only">Prazo</dt>
            <dd>
              Até <strong>{dataBR(item.prazoData)}</strong>
            </dd>
          </div>
        )}
        {item.formatos && item.formatos.length > 0 && (
          <div>
            <dt className="inline text-muted-foreground">Formatos: </dt>
            <dd className="inline">{item.formatos.map((f) => f.toUpperCase()).join(", ")}</dd>
          </div>
        )}
      </dl>
      {item.comoEnviar && <p className="mt-2 text-sm text-muted-foreground">{item.comoEnviar}</p>}

      {reprovado && item.envio?.observacao && (
        <p className="mt-3 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
          O escritório pediu um novo envio: {item.envio.observacao}
        </p>
      )}
      {item.envio?.arquivo && <p className="mt-2 text-xs text-muted-foreground">Último arquivo: {item.envio.arquivo}</p>}

      {!aprovado && (
        <div className="mt-3">
          <input
            ref={input}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const fs = Array.from(e.target.files || []);
              e.target.value = "";
              if (fs.length) onEnviar(fs);
            }}
          />
          <Button size="sm" variant={enviado ? "outline" : "default"} disabled={enviando} onClick={() => input.current?.click()}>
            {enviando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-1 h-4 w-4" />}
            {enviado || reprovado ? "Enviar outro arquivo" : "Enviar arquivo"}
          </Button>
          <span className="ml-3 hidden text-xs text-muted-foreground sm:inline">ou arraste o arquivo para cá</span>
        </div>
      )}
    </div>
  );
}


export function PassosDoCliente({
  dados,
  itemEnviando,
  onEnviar,
}: {
  dados: OnboardingCliente;
  itemEnviando: string | null;
  onEnviar: (itemId: string, files: File[]) => void;
}) {
  const { itens, progresso, cliente_nome, status } = dados;
  const pct = progresso.total ? Math.round((progresso.enviados / progresso.total) * 100) : 100;
  const boasVindas = itens.filter((i) => i.tipo === "boas_vindas");
  const passos = itens.filter((i) => i.tipo !== "boas_vindas");
  let n = 0;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <header>
        <p className="text-sm text-muted-foreground">Nescon Contabilidade</p>
        <h1 className="text-2xl font-bold">{cliente_nome ? `Olá, ${cliente_nome}` : "Seus primeiros passos"}</h1>
        {boasVindas.map((b) => (
          <p key={b.id} className="mt-2 text-muted-foreground">
            {b.descricao}
          </p>
        ))}
      </header>

      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {status === "concluido" ? "Tudo certo! Documentos aprovados." : `${progresso.enviados} de ${progresso.total} documentos enviados`}
            </span>
            <span className="text-muted-foreground">{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </CardContent>
      </Card>

      <ol className="space-y-4">
        {passos.map((item) => {
          n += 1;
          return (
            <li key={item.id}>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">{n}</span>
                    {item.tipo === "documento" ? "Enviar documento" : item.tipo === "prazo_recorrente" ? "Rotina do mês" : item.tipo === "contato" ? "Atendimento" : item.tipo === "marco" ? "Próximo marco" : "Passo"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {item.tipo === "documento" ? (
                    <ItemDocumento item={item} enviando={itemEnviando === item.id} onEnviar={(files) => onEnviar(item.id, files)} />
                  ) : (
                    <div className="flex gap-3">
                      {item.tipo === "prazo_recorrente" && <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                      {item.tipo === "contato" && <Headphones className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                      {item.tipo === "marco" && <Flag className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                      <div>
                        <p className="font-medium">{item.titulo}</p>
                        {item.descricao && <p className="mt-1 text-sm text-muted-foreground">{item.descricao}</p>}
                        {item.regra && <p className="mt-1 text-sm">{item.regra}</p>}
                        {item.contato && <p className="mt-1 text-sm">{item.contato}</p>}
                        {item.prazoData && <p className="mt-1 text-sm">Previsto para <strong>{dataBR(item.prazoData)}</strong></p>}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
