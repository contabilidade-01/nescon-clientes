import { api } from "@/lib/api";

/**
 * Abre um PDF de entrega numa aba nova.
 *
 * Se `pdfUrl` existe (ex: boletos Cora), abre direto sem download (link público).
 * Senão, busca o arquivo via API com autenticação.
 */
export async function openDeliverableFile(id: string, fileName: string, pdfUrl?: string | null): Promise<void> {
  // Se é um link público (ex: Cora), abrir direto
  if (pdfUrl) {
    const win = window.open(pdfUrl, "_blank", "noopener");
    if (!win) {
      // Popup bloqueado: fallback para download via a tag
      const a = document.createElement("a");
      a.href = pdfUrl;
      a.download = fileName || "documento.pdf";
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    return;
  }

  // Arquivo local: fetch + blob
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
