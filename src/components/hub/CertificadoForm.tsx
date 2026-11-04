import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CertificadoDados, CertificadoTipo, CertificadoTitular } from "@/lib/api";
import { CERT_TIPO_LABELS, CERT_TITULAR_LABELS } from "@/lib/certificadoDigital";

/**
 * Formulário da validade do certificado digital. O arquivo e a senha do certificado
 * nunca são pedidos: o portal só guarda até quando ele vale.
 */
export function CertificadoForm({
  inicial,
  salvando,
  onSalvar,
  onCancelar,
  textoBotao = "Salvar",
}: {
  inicial?: Partial<CertificadoDados>;
  salvando?: boolean;
  onSalvar: (d: CertificadoDados) => void;
  onCancelar?: () => void;
  textoBotao?: string;
}) {
  const [tipo, setTipo] = useState<CertificadoTipo>(inicial?.tipo ?? "a1");
  const [titular, setTitular] = useState<CertificadoTitular>(inicial?.titular ?? "e_cnpj");
  const [emissor, setEmissor] = useState(inicial?.emissor ?? "");
  const [emitido, setEmitido] = useState(inicial?.emitido_em?.slice(0, 10) ?? "");
  const [vence, setVence] = useState(inicial?.vence_em?.slice(0, 10) ?? "");

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSalvar({
          tipo,
          titular,
          emissor: emissor.trim() || null,
          emitido_em: emitido || null,
          vence_em: vence,
        });
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="cert-titular">Titular</Label>
        <Select value={titular} onValueChange={(v) => setTitular(v as CertificadoTitular)}>
          <SelectTrigger id="cert-titular"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(CERT_TITULAR_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cert-tipo">Tipo</Label>
        <Select value={tipo} onValueChange={(v) => setTipo(v as CertificadoTipo)}>
          <SelectTrigger id="cert-tipo"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(CERT_TIPO_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cert-vence">Válido até *</Label>
        <Input id="cert-vence" type="date" required value={vence} onChange={(e) => setVence(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cert-emitido">Emitido em</Label>
        <Input id="cert-emitido" type="date" value={emitido} onChange={(e) => setEmitido(e.target.value)} />
      </div>
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="cert-emissor">Certificadora (opcional)</Label>
        <Input
          id="cert-emissor"
          placeholder="Ex.: Serasa, Certisign, Valid"
          maxLength={120}
          value={emissor}
          onChange={(e) => setEmissor(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        {onCancelar && (
          <Button type="button" variant="ghost" onClick={onCancelar}>Cancelar</Button>
        )}
        <Button type="submit" disabled={salvando || !vence}>{salvando ? "Salvando..." : textoBotao}</Button>
      </div>
    </form>
  );
}
