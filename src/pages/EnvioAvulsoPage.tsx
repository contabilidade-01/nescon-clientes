import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  FileText,
  Loader2,
  Paperclip,
  Search,
  Send,
  UploadCloud,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { api, type EnvioAvulsoConfig } from "@/lib/api";
import { maskCNPJ } from "@/lib/masks";

const LS_CNPJ = "nescon_envio_avulso_cnpj";

function tamanho(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

function extensao(nome: string) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(nome);
  return m ? `.${m[1].toLowerCase()}` : "";
}

/**
 * Envio de documentos pelo cliente, sem login — /enviar. Celular ou computador.
 * CNPJ → confirma a empresa → tipo → arrasta/seleciona arquivos → envia.
 * As regras de verdade (formato, tamanho, limites) ficam no servidor; aqui só adianta o aviso.
 */
export default function EnvioAvulsoPage() {
  // ?cnpj= e ?tipo= vêm do botão do portal (cliente logado): já abre com a empresa buscada.
  const [params] = useSearchParams();
  const cnpjUrl = (params.get("cnpj") || "").replace(/\D/g, "").slice(0, 14);
  const tipoUrl = params.get("tipo") || "";
  const [config, setConfig] = useState<EnvioAvulsoConfig | null>(null);
  const [erroConfig, setErroConfig] = useState(false);
  const [cnpj, setCnpj] = useState(() => {
    if (cnpjUrl.length === 14) return cnpjUrl;
    try {
      return localStorage.getItem(LS_CNPJ) || "";
    } catch {
      return "";
    }
  });
  const [buscando, setBuscando] = useState(false);
  const [empresa, setEmpresa] = useState<string | null>(null);
  const [tipo, setTipo] = useState(tipoUrl);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [observacao, setObservacao] = useState("");
  const [remetente, setRemetente] = useState("");
  const [site, setSite] = useState(""); // campo-isca (escondido)
  const [arrastando, setArrastando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [protocolo, setProtocolo] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Enviar documentos · Nescon";
    api.envioAvulso
      .tipos()
      .then(setConfig)
      .catch(() => setErroConfig(true));
  }, []);

  // Tipo vindo da URL só vale se existir na lista do servidor.
  useEffect(() => {
    if (config && tipo && !config.tipos.some((t) => t.chave === tipo)) setTipo("");
  }, [config, tipo]);

  const buscouUrl = useRef(false);

  const aceitos = (config?.accept || "").split(",").filter(Boolean);
  const maxArquivos = config?.max_arquivos ?? 10;
  const maxArquivo = (config?.max_mb_arquivo ?? 10) * 1024 * 1024;
  const maxEnvio = (config?.max_mb_envio ?? 20) * 1024 * 1024;
  const totalBytes = arquivos.reduce((s, f) => s + f.size, 0);

  const buscar = async () => {
    const digits = cnpj.replace(/\D/g, "");
    if (digits.length !== 14) {
      setErro("Digite os 14 números do CNPJ.");
      return;
    }
    setBuscando(true);
    setErro(null);
    setEmpresa(null);
    try {
      const r = await api.envioAvulso.empresa(digits);
      if (!r.encontrada || !r.nome) {
        setErro("Não achamos este CNPJ no cadastro da Nescon. Confira os números ou fale com o escritório.");
        return;
      }
      setEmpresa(r.nome);
      try {
        localStorage.setItem(LS_CNPJ, digits);
      } catch {
        /* sem localStorage: só não lembra o CNPJ */
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível consultar agora. Tente de novo.");
    } finally {
      setBuscando(false);
    }
  };

  useEffect(() => {
    if (buscouUrl.current || cnpjUrl.length !== 14) return;
    buscouUrl.current = true;
    void buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const adicionar = (lista: FileList | File[] | null) => {
    if (!lista) return;
    setErro(null);
    const novos: File[] = [];
    const recusados: string[] = [];
    for (const f of Array.from(lista)) {
      if (aceitos.length && !aceitos.includes(extensao(f.name))) {
        recusados.push(`"${f.name}" não é um formato aceito`);
      } else if (f.size === 0) {
        recusados.push(`"${f.name}" está vazio`);
      } else if (f.size > maxArquivo) {
        recusados.push(`"${f.name}" passa de ${config?.max_mb_arquivo ?? 10} MB`);
      } else {
        novos.push(f);
      }
    }
    const juntos = [...arquivos];
    for (const f of novos) {
      if (!juntos.some((j) => j.name === f.name && j.size === f.size)) juntos.push(f);
    }
    if (juntos.length > maxArquivos) recusados.push(`no máximo ${maxArquivos} arquivos por envio`);
    setArquivos(juntos.slice(0, maxArquivos));
    if (recusados.length) setErro(`Não entrou: ${recusados.join("; ")}.`);
  };

  const enviar = async () => {
    if (!empresa) return setErro("Busque e confirme a empresa pelo CNPJ.");
    if (!tipo) return setErro("Escolha o tipo de documento.");
    if (!arquivos.length) return setErro("Anexe pelo menos um arquivo.");
    if (totalBytes > maxEnvio) {
      return setErro(`O envio passa de ${config?.max_mb_envio ?? 20} MB. Mande em duas vezes.`);
    }
    setEnviando(true);
    setProgresso(0);
    setErro(null);
    try {
      const r = await api.envioAvulso.enviar(
        { cnpj: cnpj.replace(/\D/g, ""), tipo, observacao, remetente, site },
        arquivos,
        setProgresso
      );
      setProtocolo(r.protocolo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar agora. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  const novoEnvio = () => {
    setProtocolo(null);
    setArquivos([]);
    setObservacao("");
    setTipo("");
    setProgresso(0);
    setErro(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <UploadCloud className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-foreground">Enviar documentos</h1>
            <p className="text-xs text-muted-foreground">Nescon Contabilidade</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6 pb-24">
        {protocolo ? (
          <Card>
            <CardContent className="space-y-4 p-6 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" />
              <div>
                <p className="text-lg font-semibold">Documentos enviados</p>
                <p className="text-sm text-muted-foreground">A Nescon já recebeu e vai conferir.</p>
              </div>
              <div className="rounded-lg bg-muted p-3">
                <p className="text-xs text-muted-foreground">Protocolo</p>
                <p className="font-mono text-xl font-bold tracking-wider">{protocolo}</p>
              </div>
              <Button className="w-full" onClick={novoEnvio}>
                Enviar outro documento
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="h-4 w-4 text-primary" />
                  1. Sua empresa
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void buscar();
                  }}
                >
                  <div className="flex-1">
                    <Label htmlFor="ev-cnpj" className="sr-only">
                      CNPJ
                    </Label>
                    <Input
                      id="ev-cnpj"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="CNPJ da empresa"
                      value={maskCNPJ(cnpj)}
                      onChange={(e) => {
                        setCnpj(e.target.value.replace(/\D/g, "").slice(0, 14));
                        if (empresa) setEmpresa(null);
                      }}
                    />
                  </div>
                  <Button type="submit" disabled={buscando} className="gap-2">
                    {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Buscar
                  </Button>
                </form>
                {empresa && (
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-sm font-medium">{empresa}</p>
                    <p className="text-xs text-muted-foreground">CNPJ: {maskCNPJ(cnpj)}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {empresa && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="h-4 w-4 text-primary" />
                    2. Que documento é?
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {erroConfig && (
                    <p className="text-sm text-destructive">Não carregou a lista. Recarregue a página.</p>
                  )}
                  <div className="grid gap-2 sm:grid-cols-2">
                    {config?.tipos.map((t) => (
                      <button
                        key={t.chave}
                        type="button"
                        onClick={() => setTipo(t.chave)}
                        className={`rounded-lg border px-3 py-3 text-left text-sm transition-colors ${
                          tipo === t.chave
                            ? "border-primary bg-primary/10 font-medium text-foreground"
                            : "bg-card hover:border-primary/40"
                        }`}
                      >
                        {t.rotulo}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {empresa && tipo && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Paperclip className="h-4 w-4 text-primary" />
                    3. Arquivos
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <label
                    htmlFor="ev-arquivos"
                    onDragOver={(e) => {
                      e.preventDefault();
                      setArrastando(true);
                    }}
                    onDragLeave={() => setArrastando(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setArrastando(false);
                      adicionar(e.dataTransfer.files);
                    }}
                    className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
                      arrastando ? "border-primary bg-primary/10" : "border-muted-foreground/30 hover:border-primary/60"
                    }`}
                  >
                    <UploadCloud className="h-8 w-8 text-primary" />
                    <span className="text-sm font-medium">
                      <span className="hidden sm:inline">Arraste os arquivos aqui ou clique para escolher</span>
                      <span className="sm:hidden">Toque para escolher arquivo ou tirar foto</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      PDF, foto, planilha, XML, ZIP · até {config?.max_mb_arquivo ?? 10} MB cada · até {maxArquivos}{" "}
                      arquivos
                    </span>
                  </label>
                  <input
                    id="ev-arquivos"
                    type="file"
                    multiple
                    accept={config?.accept || undefined}
                    className="sr-only"
                    onChange={(e) => {
                      adicionar(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  {arquivos.length > 0 && (
                    <ul className="space-y-2">
                      {arquivos.map((f, i) => (
                        <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">{f.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{tamanho(f.size)}</span>
                          <button
                            type="button"
                            aria-label={`Tirar ${f.name}`}
                            disabled={enviando}
                            onClick={() => setArquivos((a) => a.filter((_, j) => j !== i))}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                      <li className="text-right text-xs text-muted-foreground">
                        Total: {tamanho(totalBytes)} de {config?.max_mb_envio ?? 20} MB
                      </li>
                    </ul>
                  )}

                  <div className="space-y-1">
                    <Label htmlFor="ev-obs">Observação (opcional)</Label>
                    <Textarea
                      id="ev-obs"
                      rows={2}
                      maxLength={1000}
                      placeholder="Ex.: extrato de outubro do Itaú"
                      value={observacao}
                      onChange={(e) => setObservacao(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ev-nome">Seu nome (opcional)</Label>
                    <Input
                      id="ev-nome"
                      maxLength={120}
                      autoComplete="name"
                      value={remetente}
                      onChange={(e) => setRemetente(e.target.value)}
                    />
                  </div>
                  {/* Campo-isca para robô: escondido de gente e de leitor de tela. */}
                  <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                    <label>
                      Site
                      <input tabIndex={-1} autoComplete="off" value={site} onChange={(e) => setSite(e.target.value)} />
                    </label>
                  </div>
                </CardContent>
              </Card>
            )}

            {erro && (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {erro}
              </p>
            )}

            {empresa && tipo && (
              <div className="space-y-2">
                {enviando && <Progress value={progresso} />}
                <Button
                  className="h-12 w-full gap-2 text-base"
                  disabled={enviando || !arquivos.length}
                  onClick={() => void enviar()}
                >
                  {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                  {enviando ? `Enviando… ${progresso}%` : "Enviar para a Nescon"}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Os arquivos vão direto para o escritório. Ninguém mais tem acesso por esta página.
                </p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
