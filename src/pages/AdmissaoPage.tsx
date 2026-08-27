import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Calculator, ClipboardList, Download, Save } from "lucide-react";
import { toast } from "sonner";
import { AdmissaoFichaForm } from "@/components/AdmissaoFichaForm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import {
  emptyAdmissionDados,
  mergeAdmissionDados,
  type AdmissionDados,
  type AdmissionDetail,
  type AdmissionListItem,
} from "@/lib/admissionFicha";
import { downloadAdmissionPdf } from "@/lib/generateAdmissionPdf";
import { maskCNPJ } from "@/lib/masks";

const LS_KEY = "nescon_admission_edit";

type StoredEdit = { id: string; token: string };

function readStored(): StoredEdit | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as StoredEdit;
    if (o?.id && o?.token) return o;
  } catch {
    /* ignore */
  }
  return null;
}

const AdmissaoPage = () => {
  const { company, isAdmin } = useAuth();
  const asCompany = Boolean(company && !isAdmin);

  const [dados, setDados] = useState<AdmissionDados>(emptyAdmissionDados);
  const [empresaCnpj, setEmpresaCnpj] = useState("");
  const [empresaNome, setEmpresaNome] = useState("");
  const [contatoEmail, setContatoEmail] = useState("");
  const [contatoTelefone, setContatoTelefone] = useState("");
  const [clienteEncontrado, setClienteEncontrado] = useState<boolean | null>(asCompany ? true : null);
  const [lookupHint, setLookupHint] = useState<string | null>(null);
  const [saved, setSaved] = useState<AdmissionDetail | null>(null);
  const [lista, setLista] = useState<AdmissionListItem[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  const aplicarDetalhe = useCallback((d: AdmissionDetail) => {
    setSaved(d);
    setDados(mergeAdmissionDados(d.dados));
    setEmpresaCnpj(d.empresa_cnpj.replace(/\D/g, ""));
    setEmpresaNome(d.empresa_nome);
    setContatoEmail(d.contato_email || "");
    setContatoTelefone(d.contato_telefone || "");
    setClienteEncontrado(Boolean(d.company_id));
    if (d.edit_token) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ id: d.id, token: d.edit_token }));
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    document.title = "Ficha de registro de funcionários — Nescon Contabilidade";
  }, []);

  useEffect(() => {
    if (asCompany && company) {
      setEmpresaCnpj(company.cnpj.replace(/\D/g, ""));
      setEmpresaNome(company.name);
      setClienteEncontrado(true);
      api.admissoes
        .list()
        .then(setLista)
        .catch(() => {});
    }
  }, [asCompany, company]);

  useEffect(() => {
    if (asCompany) return;
    const stored = readStored();
    if (!stored) return;
    api.admissoes
      .publicGet(stored.id, stored.token)
      .then(aplicarDetalhe)
      .catch(() => {
        try {
          localStorage.removeItem(LS_KEY);
        } catch {
          /* ignore */
        }
      });
  }, [asCompany, aplicarDetalhe]);

  const onCnpjBlur = async () => {
    if (asCompany) return;
    const d = empresaCnpj.replace(/\D/g, "");
    if (d.length !== 14) {
      setClienteEncontrado(null);
      setLookupHint(null);
      return;
    }
    try {
      const r = await api.admissoes.lookup(d);
      if (r.encontrada) {
        setClienteEncontrado(true);
        setLookupHint("Cliente Nescon: razão social preenchida (pode editar).");
        if (r.nome && !empresaNome.trim()) setEmpresaNome(r.nome);
        else if (r.nome) setEmpresaNome(r.nome);
      } else {
        setClienteEncontrado(false);
        setLookupHint("CNPJ não encontrado na carteira — e-mail e telefone da empresa são obrigatórios.");
      }
    } catch (e) {
      setLookupHint(e instanceof Error ? e.message : "Falha ao consultar CNPJ");
    }
  };

  const exigirContato = !asCompany && clienteEncontrado === false;

  const body = () => ({
    empresa_cnpj: empresaCnpj,
    empresa_nome: empresaNome,
    contato_email: contatoEmail,
    contato_telefone: contatoTelefone,
    dados,
    ...(saved?.edit_token ? { edit_token: saved.edit_token } : {}),
  });

  const enviarAnexos = async (id: string, token?: string) => {
    if (!pendingFiles.length) return;
    if (asCompany) await api.admissoes.upload(id, pendingFiles);
    else if (token) await api.admissoes.publicUpload(id, token, pendingFiles);
    setPendingFiles([]);
  };

  const salvar = async () => {
    if (dados.nome.trim().length < 2) {
      toast.error("Informe o nome do funcionário.");
      return;
    }
    if (empresaCnpj.replace(/\D/g, "").length !== 14) {
      toast.error("Informe o CNPJ da empresa.");
      return;
    }
    if (!empresaNome.trim()) {
      toast.error("Informe a razão social.");
      return;
    }
    if (exigirContato) {
      if (!contatoEmail.includes("@")) {
        toast.error("E-mail da empresa é obrigatório.");
        return;
      }
      if (contatoTelefone.replace(/\D/g, "").length < 10) {
        toast.error("Telefone da empresa é obrigatório.");
        return;
      }
    }
    setSaving(true);
    try {
      let det: AdmissionDetail;
      if (asCompany) {
        det = saved?.id ? await api.admissoes.update(saved.id, body()) : await api.admissoes.create(body());
      } else if (saved?.id && saved.edit_token) {
        det = await api.admissoes.publicUpdate(saved.id, body());
      } else {
        det = await api.admissoes.publicCreate(body());
      }
      await enviarAnexos(det.id, det.edit_token);
      const fresh = asCompany
        ? await api.admissoes.get(det.id)
        : det.edit_token
          ? await api.admissoes.publicGet(det.id, det.edit_token)
          : det;
      aplicarDetalhe({ ...fresh, edit_token: fresh.edit_token || det.edit_token });
      if (asCompany) {
        const l = await api.admissoes.list();
        setLista(l);
      }
      toast.success("Ficha salva. Você já pode baixar o PDF.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar");
    } finally {
      setSaving(false);
    }
  };

  const novaFicha = () => {
    setSaved(null);
    setDados(emptyAdmissionDados());
    setPendingFiles([]);
    if (asCompany && company) {
      setEmpresaCnpj(company.cnpj.replace(/\D/g, ""));
      setEmpresaNome(company.name);
    }
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
  };

  const abrirLista = async (id: string) => {
    try {
      const d = await api.admissoes.get(id);
      aplicarDetalhe(d);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não abriu a ficha");
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <Card className="mx-auto w-full max-w-3xl overflow-hidden">
        <div className="bg-gradient-to-r from-primary/90 to-primary/60 px-6 py-6 text-primary-foreground">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15">
              <ClipboardList className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wide opacity-85">Nescon Contabilidade</p>
              <h1 className="text-xl font-bold leading-tight">Ficha de registro de funcionários</h1>
              <p className="text-sm opacity-90">
                Preencha, salve e baixe o PDF. O escritório é avisado automaticamente.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Link to="/calculadora-custo" className="inline-flex items-center gap-1 underline opacity-90 hover:opacity-100">
              <Calculator className="h-3.5 w-3.5" /> Calculadora de custo
            </Link>
            {asCompany && (
              <Link to="/" className="underline opacity-90 hover:opacity-100">
                Voltar ao portal
              </Link>
            )}
          </div>
        </div>

        <div className="space-y-6 p-6">
          {asCompany && lista.length > 0 && (
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Fichas desta empresa</p>
              <ul className="space-y-1 text-sm">
                {lista.map((f) => (
                  <li key={f.id}>
                    <button type="button" className="text-primary underline" onClick={() => abrirLista(f.id)}>
                      {f.funcionario_nome}
                    </button>
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      · {new Date(f.updated_at).toLocaleDateString("pt-BR")} · {f.status}
                    </span>
                  </li>
                ))}
              </ul>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={novaFicha}>
                Nova ficha
              </Button>
            </div>
          )}

          <AdmissaoFichaForm
            dados={dados}
            onDados={setDados}
            empresaCnpj={empresaCnpj}
            empresaNome={empresaNome}
            contatoEmail={contatoEmail}
            contatoTelefone={contatoTelefone}
            onEmpresa={(p) => {
              if (p.empresaCnpj !== undefined) setEmpresaCnpj(p.empresaCnpj);
              if (p.empresaNome !== undefined) setEmpresaNome(p.empresaNome);
              if (p.contatoEmail !== undefined) setContatoEmail(p.contatoEmail);
              if (p.contatoTelefone !== undefined) setContatoTelefone(p.contatoTelefone);
            }}
            cnpjLocked={asCompany}
            exigirContatoExterno={exigirContato}
            lookupHint={lookupHint}
            onCnpjBlur={onCnpjBlur}
            anexos={saved?.anexos}
            pendingFiles={pendingFiles}
            onPendingFiles={setPendingFiles}
          />

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button type="button" onClick={salvar} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Salvando..." : saved ? "Salvar alterações" : "Salvar ficha"}
            </Button>
            {saved && (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  downloadAdmissionPdf({
                    empresaNome,
                    empresaCnpj,
                    contatoEmail,
                    contatoTelefone,
                    dados,
                  })
                }
              >
                <Download className="mr-2 h-4 w-4" />
                Baixar PDF
              </Button>
            )}
          </div>
        </div>

        <div className="py-3 text-center text-[11px] text-muted-foreground">
          Nescon Contabilidade • CNPJ {maskCNPJ("35736034000123")}
        </div>
      </Card>
    </div>
  );
};

export default AdmissaoPage;
