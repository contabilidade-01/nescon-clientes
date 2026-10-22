import { describe, expect, it } from "vitest";
import { agruparDebitos, mesAno, podeGerar } from "@/lib/ecacDebitos";
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
  it("INSS com recalculo_disponivel=false gravado no espelho pode gerar DARF (agrupada)", () => {
    const velho = (receita: string, valor: number) => ({
      ...d("INSS", receita, "202603", "2026-04-20", valor), recalculo_disponivel: false, guia: null,
    });
    const r = agruparDebitos([velho("1082-01 - CP-SEGUR.", 153.87), velho("1099-01 - CP-SEGUR.", 10)]);
    expect(r).toHaveLength(1);
    expect(r[0].tipo_guia).toBe("DCTFWEB");
    expect(r[0].pode_gerar).toBe(true);
    expect(r[0].saldo_devedor_total).toBe(163.87);
  });
  it("pode gerar só com tipo emissível e competência válida", () => {
    expect(podeGerar({ tipo: "SN", periodo_aaaamm: "202604" })).toBe(true);
    expect(podeGerar({ tipo: "MEI", periodo_aaaamm: "202604" })).toBe(true);
    expect(podeGerar({ tipo: "INSS", periodo_aaaamm: null })).toBe(false);
    expect(podeGerar({ tipo: "IRRF", periodo_aaaamm: "202604" })).toBe(false);
    expect(podeGerar({ tipo: "SN", periodo_aaaamm: "202613" })).toBe(false);
    expect(podeGerar({ tipo: "INSS", periodo_aaaamm: "202513" })).toBe(true);
  });
  it("formata parcela", () => expect(mesAno("202609")).toBe("09/2026"));
});
