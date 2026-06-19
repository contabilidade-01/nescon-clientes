/**
 * Página "Envio de Guias" — embute o sistema GCLICK (FastAPI) num iframe.
 * O sistema roda como app próprio (separado) em https://guias.gestaoempresa.com.
 * Acesso restrito a admin (ver rota /guias com AdminOnlyRoute em App.tsx).
 */
const GUIAS_URL = "https://guias.gestaoempresa.com";

export default function GuiasPage() {
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 14px",
          borderBottom: "1px solid #e5e7eb",
          background: "#fff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <a href="/admin" style={{ textDecoration: "none", color: "#1e3a5f", fontSize: 14 }}>
          ← Voltar ao painel
        </a>
        <strong style={{ fontSize: 14 }}>📤 Envio de Guias</strong>
        <a
          href={GUIAS_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: "auto", fontSize: 12, color: "#6b7280" }}
        >
          abrir em nova aba ↗
        </a>
      </div>
      <iframe
        src={GUIAS_URL}
        title="Envio de Guias"
        style={{ flex: 1, width: "100%", border: 0 }}
      />
    </div>
  );
}
