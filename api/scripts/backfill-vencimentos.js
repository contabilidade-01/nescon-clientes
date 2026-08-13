/**
 * Backfill (linha de comando) — corrige o `due_date` dos documentos do núcleo
 * (FGTS/DAS/DCTF Web) já gravados com data errada, recalculando pela regra.
 *
 * Mesma lógica do botão "Corrigir pela regra" da tela (Vencimentos sugeridos): os dois
 * delegam a reaplicarRegraNucleo() — uma fonte só da verdade. Existe para quem preferir
 * o terminal; pela interface é o caminho recomendado.
 *
 * ## Uso (dentro do container da API, na VPS — usa as mesmas variáveis DB_*)
 *
 *   node scripts/backfill-vencimentos.js                 # DRY-RUN: só mostra o que mudaria
 *   node scripts/backfill-vencimentos.js --apply         # aplica de verdade
 *   node scripts/backfill-vencimentos.js --desde=2024-04 # competência mínima (padrão)
 *   node scripts/backfill-vencimentos.js --apply --desde=2024-04
 *
 * FGTS mensal só passou a vencer dia 20 com o FGTS Digital; guias antigas venciam dia 7
 * LEGITIMAMENTE — por isso o corte por competência (padrão 2024-04) e o dry-run primeiro.
 */
const db = require("../src/db");
const { reaplicarRegraNucleo } = require("../src/reaplicarRegraNucleo");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const desdeArg = args.find((a) => a.startsWith("--desde="));
const DESDE = desdeArg ? desdeArg.split("=")[1] : "2024-04";

async function main() {
  console.log(`\nBackfill de vencimentos — ${APPLY ? "APLICANDO" : "DRY-RUN (nada é escrito)"}`);
  console.log(`Competência mínima (--desde): ${DESDE}\n`);

  const r = await reaplicarRegraNucleo(db, { desde: DESDE, simular: !APPLY });

  console.log(`Candidatos analisados: ${r.analisados}`);
  console.log(`A CORRIGIR: ${r.corrigidos}\n`);

  if (r.mudancas.length) {
    console.log("empresa | competência | tipo | de → para | documento");
    console.log("-".repeat(90));
    for (const m of r.mudancas) {
      console.log(`${m.empresa} | ${m.competencia} | ${m.doc_type} | ${m.de || "—"} → ${m.para} | ${m.title}`);
    }
    console.log("");
  }

  if (!APPLY) {
    console.log("DRY-RUN concluído. Reveja a lista e rode com --apply para gravar.\n");
  } else {
    console.log(`Concluído: ${r.corrigidos} vencimento(s) corrigido(s).\n`);
  }
  await db.end();
}

main().catch((err) => {
  console.error("Backfill falhou:", err.message);
  process.exit(1);
});
