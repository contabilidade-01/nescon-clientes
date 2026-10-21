import { describe, expect, it } from "vitest";
import { agruparDebitos, mesAno } from "@/lib/ecacDebitos";
import type { EcacDebito } from "@/lib/api";

const d = (tipo: string, receita: string, pa: string, venc: string, valor: number): EcacDebito => ({
  tipo, receita, periodo_apuracao: `${pa.slice(4)}/${pa.slice(0, 4)}`, periodo_aaaamm: pa, data_vencimento: venc,
  valor_original: valor, saldo_devedor: valor, multa: 0, juros: 0, saldo_devedor_total: valor, situacao: "DEVEDOR",
  em_atraso: true, valido: true, motivos: [], guia: null, recalculo_disponivel: true,
});

describe("agruparDebitos", () => {
  it("junta INSS da mesma competência numa DARF e mantém os demais", () => {
    const r = agruparDebitos([
      d("INSS", "1082-01 - CP-SEGUR.", "202604", "2026-05-20", 4928.53),
      d("INSS", "1099-01 - CP-SEGUR.", "202604", "2026-05-20", 223.79),
      d("INSS", "1082-01 - CP-SEGUR.", "202605", "2026-06-19", 6113.76),
      d("SN", "SIMPLES NAC.", "202604", "2026-05-20", 100),
    ]);
    expect(r).toHaveLength(3);
    expect(r[0].tipo_guia).toBe("DCTFWEB");
    expect(r[0].saldo_devedor_total).toBe(5152.32);
    expect(r[0].codigos).toEqual(["1082-01 - CP-SEGUR.", "1099-01 - CP-SEGUR."]);
    expect(r[1].periodo_aaaamm).toBe("202605");
    expect(r[2].tipo_guia).toBe("SN");
  });
  it("formata parcela", () => expect(mesAno("202609")).toBe("09/2026"));
});
