import type { Bloco } from "@/lib/contratoModelo";

/**
 * Prévia do contrato (mesmos blocos do PDF) com visual de documento: faixa azul-marinho,
 * dourado e caixas bege. Também é o que sai na impressão do navegador (Ctrl+P): o CSS
 * de impressão esconde o resto da tela e deixa só o documento, em A4.
 */

function Rich({ t }: { t: string }) {
  const partes = t.split(/(\*\*.+?\*\*|\[[^\]]+\])/g);
  return (
    <>
      {partes.map((p, i) => {
        if (!p) return null;
        if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("[") && p.endsWith("]")) return <mark key={i}>{p}</mark>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

const CSS = `
.cd { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; color: #141414; background: #fff; font-size: 10.5pt; line-height: 1.45; }
.cd * { box-sizing: border-box; }
.cd mark { background: #fff176; color: inherit; font-weight: 700; padding: 0 2px; }
.cd strong { font-weight: 700; }
.cd-page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 14mm 16mm 18mm; background: #fff; position: relative; }
.cd-band { background: #1F2A44; color: #fff; margin: -14mm -16mm 10mm -16mm; padding: 9mm 16mm 7mm; border-radius: 0 0 10px 0; width: 65%; }
.cd-band h1 { margin: 0; font-size: 18pt; font-weight: 700; letter-spacing: .02em; border-bottom: 1px solid rgba(255,255,255,.7); padding-bottom: 2px; }
.cd-band h2 { margin: 3px 0 0; font-size: 12pt; font-weight: 400; }
.cd-logo { position: absolute; top: 8mm; right: 14mm; width: 26mm; height: 26mm; object-fit: contain; }
.cd-resumo-h { font-weight: 700; color: #1F2A44; font-size: 10pt; margin: 0 0 4px; }
.cd-resumo-h i { font-weight: 400; color: #5A5A5A; font-size: 8pt; }
.cd-resumo { display: grid; grid-template-columns: 1fr 1fr; margin-bottom: 8px; }
.cd-resumo > div { padding: 7px 10px; }
.cd-resumo > div:nth-child(1), .cd-resumo > div:nth-child(4) { background: #F5ECD9; }
.cd-resumo > div:nth-child(2), .cd-resumo > div:nth-child(3) { background: #FBF7EE; }
.cd-resumo b { display: block; color: #1F2A44; font-size: 9.5pt; }
.cd-resumo p { margin: 0; font-size: 9pt; }
.cd-secao { text-align: center; color: #1F2A44; font-weight: 700; font-size: 12pt; border-bottom: 1.5px solid #CD9F3F; padding-bottom: 4px; margin: 16px 0 10px; break-after: avoid; }
.cd-sub { font-weight: 700; color: #1F2A44; font-size: 10pt; margin: 6px 0 4px; break-after: avoid; }
.cd-sub i { font-weight: 400; color: #5A5A5A; font-size: 8pt; }
.cd-parte { display: flex; margin-bottom: 8px; break-inside: avoid; }
.cd-parte .l { background: #1F2A44; color: #fff; font-weight: 700; font-size: 7pt; width: 24mm; display: flex; align-items: center; justify-content: center; }
.cd-parte .r { flex: 1; border: 1px solid #CD9F3F; border-left: 0; padding: 8px 10px; text-align: justify; font-size: 10pt; }
.cd-par { margin: 0 0 6px; text-align: justify; }
.cd-par .num { font-weight: 700; color: #1F2A44; }
.cd-barra { border-left: 3px solid #CD9F3F; padding-left: 8px; margin: 0 0 7px 8px; text-align: justify; }
.cd-barra .rot { font-weight: 700; color: #1F2A44; }
.cd-cartoes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 8px; break-inside: avoid; }
.cd-cartoes > div { border: 1px solid #CD9F3F; padding: 8px; }
.cd-cartoes h4 { margin: 0 0 6px; text-align: center; color: #1F2A44; font-size: 9pt; }
.cd-cartoes p { margin: 0 0 4px; font-size: 8.5pt; }
.cd-cartoes p::before { content: "✓ "; color: #CD9F3F; font-weight: 700; }
.cd-lista { width: 100%; border-collapse: separate; border-spacing: 0 2px; margin-bottom: 8px; }
.cd-lista td { vertical-align: middle; break-inside: avoid; }
.cd-lista td.l { background: #1F2A44; color: #fff; font-weight: 700; text-align: center; width: 9mm; font-size: 9pt; }
.cd-lista td.l.w { width: 27mm; font-size: 7pt; }
.cd-lista td.r { border: 1px solid #E3D3AE; border-left: 0; padding: 5px 8px; font-size: 9pt; text-align: justify; }
.cd-kv td.l { width: 32mm; font-size: 7pt; }
.cd-kv td.r p { margin: 0 0 3px; }
.cd-alerta { display: flex; margin-bottom: 8px; break-inside: avoid; }
.cd-alerta .l { background: #CD9F3F; color: #fff; font-size: 20pt; font-weight: 700; width: 12mm; display: flex; align-items: center; justify-content: center; }
.cd-alerta .r { flex: 1; background: #F7F7F7; padding: 7px 10px; font-size: 9.5pt; text-align: justify; }
.cd-alerta .rot { font-weight: 700; }
.cd-dest { display: flex; margin-bottom: 8px; break-inside: avoid; }
.cd-dest .l { background: #1F2A44; width: 16mm; position: relative; }
.cd-dest .l::after { content: ""; position: absolute; left: 5mm; right: 5mm; top: 50%; border-top: 2px solid #CD9F3F; }
.cd-dest .r { flex: 1; background: #F5ECD9; padding: 7px 10px; }
.cd-dest .t { font-size: 8pt; font-weight: 700; color: #1F2A44; }
.cd-dest .v { font-size: 11pt; font-weight: 700; }
.cd-dest p { margin: 0; font-size: 9pt; }
.cd-legenda { text-align: center; font-weight: 700; color: #1F2A44; font-size: 8.5pt; margin: 6px 0 4px; break-after: avoid; }
.cd-passos { display: grid; grid-template-columns: 1fr 8mm 1fr 8mm 1fr; align-items: stretch; margin-bottom: 8px; break-inside: avoid; }
.cd-passos .c { padding: 6px 8px; text-align: center; }
.cd-passos .c:nth-child(1), .cd-passos .c:nth-child(5) { background: #F5ECD9; }
.cd-passos .c:nth-child(3) { background: #FBF7EE; }
.cd-passos .n { color: #CD9F3F; font-size: 15pt; font-weight: 700; }
.cd-passos .t { color: #1F2A44; font-weight: 700; font-size: 8.5pt; }
.cd-passos p { margin: 0; font-size: 8pt; }
.cd-passos .a { display: flex; align-items: center; justify-content: center; color: #CD9F3F; font-size: 11pt; }
.cd-escudo { display: flex; margin-bottom: 8px; break-inside: avoid; }
.cd-escudo .l { background: #F5ECD9; width: 14mm; display: flex; justify-content: center; padding-top: 8px; color: #1F2A44; font-size: 14pt; }
.cd-escudo .r { flex: 1; border: 1px solid #CD9F3F; padding: 8px 10px; }
.cd-escudo h5 { margin: 0 0 2px; color: #1F2A44; font-size: 9pt; }
.cd-escudo p { margin: 0 0 8px; font-size: 9.5pt; text-align: justify; }
.cd-escudo p:last-child { margin-bottom: 0; }
.cd-data { text-align: right; font-weight: 700; margin: 6px 0 10px; }
.cd-ass { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 20px; break-inside: avoid; }
.cd-ass > div { text-align: center; padding: 0 10px; }
.cd-ass .rot { color: #8A6A22; font-weight: 700; font-size: 7.5pt; margin-bottom: 14mm; }
.cd-ass .nome { border-top: 1px solid #1F2A44; padding-top: 3px; font-weight: 700; color: #1F2A44; font-size: 9.5pt; }
.cd-ass p { margin: 0; font-size: 8.5pt; }
.cd-quebra { break-before: page; height: 0; }
.cd-rodape { position: absolute; left: 16mm; right: 16mm; bottom: 8mm; border-top: 2px solid #CD9F3F; padding-top: 4px; font-size: 7.5pt; color: #5A5A5A; display: flex; justify-content: space-between; }
.cd-rodape b { color: #1F2A44; }
@media screen { .cd-page { box-shadow: 0 2px 12px rgba(0,0,0,.15); } }
@media print {
  @page { size: A4; margin: 12mm 14mm 16mm; }
  body * { visibility: hidden !important; }
  .contrato-print-root, .contrato-print-root * { visibility: visible !important; }
  .contrato-print-root { position: absolute !important; left: 0; top: 0; width: 100%; margin: 0; padding: 0; }
  .cd-page { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
  .cd-band { margin: 0 0 8mm 0; border-radius: 0; }
  .cd-logo { top: 0; right: 0; }
  .cd-rodape { display: none; }
  .cd-quebra { break-before: page; }
}
`;

export function ContratoPreview({
  blocos,
  logoUrl,
  rodapeEsquerda,
  rodapeDireita,
  faixa,
}: {
  blocos: Bloco[];
  logoUrl?: string | null;
  rodapeEsquerda: string[];
  rodapeDireita: string[];
  /** Faixa do topo; o padrão é a de contrato. */
  faixa?: { titulo: string; subtitulo: string };
}) {
  return (
    <div className="contrato-print-root">
      <style>{CSS}</style>
      <div className="cd">
        <div className="cd-page">
          <div className="cd-band">
            <h1>{faixa?.titulo ?? "CONTRATO"}</h1>
            <h2>{faixa?.subtitulo ?? "PRESTAÇÃO DE SERVIÇOS CONTÁBEIS"}</h2>
          </div>
          {logoUrl ? <img className="cd-logo" src={logoUrl} alt="" /> : null}
          {blocos.map((b, i) => (
            <BlocoView key={i} b={b} />
          ))}
          <div className="cd-rodape">
            <div>
              {rodapeEsquerda.map((l, k) => (
                <div key={k}>{l}</div>
              ))}
            </div>
            <div style={{ textAlign: "right" }}>
              {rodapeDireita.map((l, k) => (
                <div key={k}>{k === 0 ? <b>{l}</b> : l}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BlocoView({ b }: { b: Bloco }) {
  switch (b.t) {
    case "resumo":
      return (
        <>
          <p className="cd-resumo-h">
            EM RESUMO <i>· o essencial deste contrato, antes das cláusulas</i>
          </p>
          <div className="cd-resumo">
            {b.itens.map((it, i) => (
              <div key={i}>
                <b>{it.titulo}</b>
                <p>
                  <Rich t={it.texto} />
                </p>
              </div>
            ))}
          </div>
        </>
      );
    case "secao":
      return <h3 className="cd-secao">{b.titulo}</h3>;
    case "subtitulo":
      return (
        <p className="cd-sub">
          {b.titulo} <i>· {b.sub}</i>
        </p>
      );
    case "parte":
      return (
        <div className="cd-parte">
          <div className="l">{b.rotulo}</div>
          <div className="r">
            <Rich t={b.texto} />
          </div>
        </div>
      );
    case "clausula":
      return (
        <p className="cd-par">
          <span className="num">{b.num} </span>
          <Rich t={b.texto} />
        </p>
      );
    case "par":
      return (
        <p className="cd-par">
          <Rich t={b.texto} />
        </p>
      );
    case "barra":
      return (
        <p className="cd-barra">
          <span className="rot">{b.rotulo} </span>
          <Rich t={b.texto} />
        </p>
      );
    case "cartoes":
      return (
        <div className="cd-cartoes" style={{ gridTemplateColumns: `repeat(${b.colunas.length}, 1fr)` }}>
          {b.colunas.map((c, i) => (
            <div key={i}>
              <h4>{c.titulo}</h4>
              {c.itens.map((it, k) => (
                <p key={k}>
                  <Rich t={it} />
                </p>
              ))}
            </div>
          ))}
        </div>
      );
    case "lista":
      return (
        <table className="cd-lista">
          <tbody>
            {b.itens.map((it, i) => (
              <tr key={i}>
                <td className={`l${b.rotulos ? " w" : ""}`}>{b.rotulos ? b.rotulos[i] : "abcdefghijklmnop"[i]}</td>
                <td className="r">
                  <Rich t={it} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "kv":
      return (
        <table className="cd-lista cd-kv">
          <tbody>
            {b.itens.map((it, i) => (
              <tr key={i}>
                <td className="l w">{it.rotulo}</td>
                <td className="r">
                  {it.linhas.map((l, k) => (
                    <p key={k}>
                      <Rich t={l} />
                    </p>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "alerta":
      return (
        <div className="cd-alerta">
          <div className="l">!</div>
          <div className="r">
            {b.rotulo ? <span className="rot">{b.rotulo} </span> : null}
            <Rich t={b.texto} />
          </div>
        </div>
      );
    case "destaque":
      return (
        <div className="cd-dest">
          <div className="l" />
          <div className="r">
            <div className="t">{b.titulo}</div>
            <div className="v">
              <Rich t={b.valor} />
            </div>
            {b.linhas.map((l, k) => (
              <p key={k}>
                <Rich t={l} />
              </p>
            ))}
          </div>
        </div>
      );
    case "passos":
      return (
        <div className="cd-passos">
          {b.itens.map((it, i) => (
            <FragmentPasso key={i} it={it} i={i} ultimo={i === b.itens.length - 1} />
          ))}
        </div>
      );
    case "legenda":
      return <p className="cd-legenda">{b.texto}</p>;
    case "escudo":
      return (
        <div className="cd-escudo">
          <div className="l">⛨</div>
          <div className="r">
            {b.blocos.map((x, i) => (
              <div key={i}>
                <h5>{x.titulo}</h5>
                <p>
                  <Rich t={x.texto} />
                </p>
              </div>
            ))}
          </div>
        </div>
      );
    case "data":
      return (
        <p className="cd-data">
          <Rich t={b.texto} />
        </p>
      );
    case "assinaturas":
      return (
        <div className="cd-ass">
          {b.itens.map((it, i) => (
            <div key={i}>
              <div className="rot">{it.rotulo}</div>
              <div className="nome">
                <Rich t={it.nome} />
              </div>
              {it.linhas.map((l, k) => (
                <p key={k}>
                  <Rich t={l} />
                </p>
              ))}
            </div>
          ))}
        </div>
      );
    case "quebra":
      return <div className="cd-quebra" />;
    default:
      return null;
  }
}

function FragmentPasso({ it, i, ultimo }: { it: { titulo: string; texto: string }; i: number; ultimo: boolean }) {
  return (
    <>
      <div className="c">
        <div className="n">{i + 1}</div>
        <div className="t">{it.titulo}</div>
        <p>
          <Rich t={it.texto} />
        </p>
      </div>
      {!ultimo ? <div className="a">►</div> : null}
    </>
  );
}
