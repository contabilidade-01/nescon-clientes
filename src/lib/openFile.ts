import { api } from "@/lib/api";

/**
 * Abre um PDF de entrega numa aba nova.
 *
 * A rota exige Bearer, e um `<a href>` não envia cabeçalhos — por isso o arquivo é
 * buscado por fetch e aberto como blob local.
 */
export async function openDeliverableFile(id: string, fileName: string): Promise<void> {
  const blob = await api.deliverables.fetchFile(id);
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener");
  if (!win) {
    // Popup bloqueado: cai para download direto.
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "documento.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // Dá tempo do visualizador carregar antes de libertar a memória.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
