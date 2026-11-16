import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  extractFileCnpj,
  parseEmployeesCsv,
  spreadsheetBufferToText,
  toImportPayload,
} from "@/lib/parseEmployeeSpreadsheet";
import { lerCelulasXlsBiff } from "@/lib/xlsBiff";

const sampleCsv = `Empresa:;EMPRESA EXEMPLO LTDA;;
C.N.P.J.:;12.345.678/0001-95;;
RELAÇÃO DE EMPREGADOS;;;
Nome;;CPF;Data demissão
JOAO DA SILVA SANTOS;;12345678900;
MARIA APARECIDA DE SOUZA;;98765432100;
PEDRO HENRIQUE OLIVEIRA;;11122233344;01/01/2020`;

// Relação de Empregados do Domínio SEM CPF: nome, situação (1 trabalhando / 8 demitido)
// e a data de demissão como data do Excel (número de série).
const semCpfCsv = `Empresa:;;;RESTAURANTE EXEMPLO LTDA;;;;;;;;;;;Página:;;1/1
C.N.P.J.:;;;54.803.962/0001-08;;;;;;;;;;;Emissão:;;46325.64
;;;;;;;;;;;;;;;;
RELAÇÃO DE EMPREGADOS;;;;;;;;;;;;;;;;
Nome;;;;;;;Situação;;;;Data demissão;;;;;
HENRIQUE BENIGNO CHAVES;;;;;;;8;;;;45881;;;;;
MATHEUS MATOS ALVES TAKAHASHI;;;;;;;1;;;;;;;;;
SILVANA ELIZABETH COSTA DE OLIVEIRA ;;;;;;;1;;;;;;;;;
;Total de itens listados:;;;;3;;;;;;;;;;;`;

describe("parseEmployeeSpreadsheet", () => {
  it("extracts CNPJ from relação de empregados format", () => {
    expect(extractFileCnpj(sampleCsv)).toBe("12345678000195");
  });

  it("parses active employees and separates dismissed", () => {
    const { rows, dismissed, skippedDismissed } = parseEmployeesCsv(sampleCsv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: "JOAO DA SILVA SANTOS", cpf: "12345678900" });
    expect(dismissed).toEqual([{ name: "PEDRO HENRIQUE OLIVEIRA", cpf: "11122233344" }]);
    expect(skippedDismissed).toBe(1);
  });

  it("lê a Relação de Empregados sem CPF, pela situação e data de demissão", () => {
    expect(extractFileCnpj(semCpfCsv)).toBe("54803962000108");
    const r = parseEmployeesCsv(semCpfCsv);
    expect(r.rows.map((x) => x.name)).toEqual([
      "MATHEUS MATOS ALVES TAKAHASHI",
      "SILVANA ELIZABETH COSTA DE OLIVEIRA",
    ]);
    expect(r.rows.every((x) => x.cpf === "")).toBe(true);
    expect(r.dismissed.map((x) => x.name)).toEqual(["HENRIQUE BENIGNO CHAVES"]);
    expect(r.withoutCpf).toBe(3);
  });

  it("recontratado (demitido e ativo na mesma lista) fica ativo", () => {
    const csv = `Nome;Situação;Data demissão
ANA LIMA;8;01/02/2025
ANA LIMA;1;`;
    const r = parseEmployeesCsv(csv);
    expect(r.rows.map((x) => x.name)).toEqual(["ANA LIMA"]);
    expect(r.dismissed).toHaveLength(0);
  });

  it("monta o envio com a situação explícita", () => {
    const r = parseEmployeesCsv(sampleCsv);
    const payload = toImportPayload(r);
    expect(payload.filter((p) => p.active === false).map((p) => p.cpf)).toEqual(["11122233344"]);
    expect(payload.filter((p) => p.active === true)).toHaveLength(2);
  });
});

/** Monta um .xls como o do Domínio: células da aba SEM o registro BOF da aba. */
function xlsSemBofDaAba(): Uint8Array {
  const rec = (tipo: number, corpo: number[]) => [tipo & 255, tipo >> 8, corpo.length & 255, corpo.length >> 8, ...corpo];
  const u16 = (n: number) => [n & 255, (n >> 8) & 255];
  const u32 = (n: number) => [...u16(n & 0xffff), ...u16(n >>> 16)];
  const f64 = (n: number) => Array.from(new Uint8Array(new Float64Array([n]).buffer));
  const textos = ["Empresa:", "RESTAURANTE EXEMPLO LTDA", "C.N.P.J.:", "54.803.962/0001-08", "Nome", "Situação", "Data demissão", "ANA PAULA SOUZA", "JOSÉ CARLOS"];
  const sst = [...u32(textos.length), ...u32(textos.length)];
  for (const t of textos) {
    sst.push(...u16(t.length), 1);
    for (const ch of t) sst.push(...u16(ch.charCodeAt(0)));
  }
  const labelSst = (r: number, c: number, i: number) => rec(0xfd, [...u16(r), ...u16(c), ...u16(0), ...u32(i)]);
  const number = (r: number, c: number, n: number) => rec(0x203, [...u16(r), ...u16(c), ...u16(0), ...f64(n)]);
  const rk = (r: number, c: number, n: number) => rec(0x27e, [...u16(r), ...u16(c), ...u16(0), ...u32(((n << 2) | 2) >>> 0)]);
  const bytes = [
    ...rec(0x809, [0, 6, 5, 0, ...Array(12).fill(0)]),
    ...rec(0xfc, sst),
    ...rec(0x0a, []),
    // aba começa aqui, sem BOF
    ...labelSst(0, 0, 0), ...labelSst(0, 3, 1),
    ...labelSst(1, 0, 2), ...labelSst(1, 3, 3),
    ...labelSst(3, 0, 4), ...labelSst(3, 7, 5), ...labelSst(3, 11, 6),
    ...labelSst(4, 0, 7), ...rk(4, 7, 1),
    ...labelSst(5, 0, 8), ...number(5, 7, 8), ...number(5, 11, 45881),
    ...rec(0x0a, []),
  ];
  const cfb = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(cfb, "Workbook", new Uint8Array(bytes));
  return new Uint8Array(XLSX.CFB.write(cfb, { type: "array" }) as number[]);
}

describe("xls do Domínio que o SheetJS não abre", () => {
  it("lê as células direto do fluxo e reconhece a listagem", () => {
    const buf = xlsSemBofDaAba();
    const texto = spreadsheetBufferToText(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    expect(extractFileCnpj(texto)).toBe("54803962000108");
    const r = parseEmployeesCsv(texto);
    expect(r.rows).toEqual([{ name: "ANA PAULA SOUZA", cpf: "" }]);
    expect(r.dismissed).toEqual([{ name: "JOSÉ CARLOS", cpf: "" }]);
  });

  it("o leitor direto devolve as células nas colunas certas", () => {
    const linhas = lerCelulasXlsBiff(xlsSemBofDaAba())!;
    expect(linhas[1][3]).toBe("54.803.962/0001-08");
    expect(linhas[4][0]).toBe("ANA PAULA SOUZA");
    expect(linhas[4][7]).toBe("1");
    expect(linhas[5][11]).toBe("45881");
  });
});
