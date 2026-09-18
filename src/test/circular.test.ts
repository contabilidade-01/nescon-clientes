import { describe, it, expect } from "vitest";
import { planejarEnvios, intervaloMs, tipoDaMidia } from "../../api/src/circular.js";

describe("planejarEnvios", () => {
  const empresas = [
    { id: "a", name: "A LTDA", whatsapp: "11974208965" },
    { id: "b", name: "B LTDA", whatsapp: "(11) 97420-8965" }, // mesmo número da A
    { id: "c", name: "C LTDA", whatsapp: "1140028922" }, // fixo
    { id: "d", name: "D LTDA", whatsapp: null },
    { id: "e", name: "E LTDA", whatsapp: "34999998888" },
  ];

  it("fila só celular válido, uma vez por número", () => {
    const r = planejarEnvios(empresas);
    const por = Object.fromEntries(r.map((x) => [x.company_id, x.status]));
    expect(por).toEqual({ a: "pendente", b: "duplicado", c: "sem_whatsapp", d: "sem_whatsapp", e: "pendente" });
    expect(r.find((x) => x.company_id === "a")!.numero).toBe("5511974208965");
  });

  it("segundo lote (teste → todas) não repete quem já recebeu", () => {
    const r = planejarEnvios(empresas, {
      jaNaCircular: new Set(["a"]),
      numerosJaUsados: new Set(["5511974208965"]),
    });
    expect(r.find((x) => x.company_id === "a")).toBeUndefined();
    expect(r.find((x) => x.company_id === "b")!.status).toBe("duplicado");
    expect(r.find((x) => x.company_id === "e")!.status).toBe("pendente");
  });
});

describe("intervaloMs", () => {
  it("fica entre 20s e 40s", () => {
    expect(intervaloMs(0)).toBe(20000);
    expect(intervaloMs(1)).toBe(40000);
    expect(intervaloMs(0.5)).toBe(30000);
  });
});

describe("tipoDaMidia", () => {
  it("aceita só o que o WhatsApp mostra na conversa", () => {
    expect(tipoDaMidia("video/mp4")).toBe("video");
    expect(tipoDaMidia("image/jpeg")).toBe("image");
    expect(tipoDaMidia("image/png")).toBe("image");
    expect(tipoDaMidia("application/octet-stream", "circular.mp4")).toBe("video");
    expect(tipoDaMidia("video/quicktime", "x.mov")).toBeNull();
    expect(tipoDaMidia("application/pdf", "x.pdf")).toBeNull();
  });
});
