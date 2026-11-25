// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ar = require("../../api/src/whatsappAutoResposta.js");

describe("resposta automática fora de advertência/suspensão", () => {
  it("diz que o canal é só para documentos e alertas e manda falar com o escritório", () => {
    const t = ar.textoAutoResposta();
    expect(t).toMatch(/apenas para o envio de documentos e alertas/);
    expect(t).toMatch(/rec[aá]lculos/);
    expect(t).toMatch(/demais pedidos/);
    expect(t).toMatch(/advert[eê]ncia/);
  });

  it("responde só quando o banco marcou o envio (fora do intervalo)", async () => {
    const chamadas: unknown[][] = [];
    const dbEnvia = { query: async (_sql: string, p: unknown[]) => (chamadas.push(p), { rows: [{ phone: p[0] }] }) };
    expect(await ar.autoRespostaPara(dbEnvia, "+55 (11) 99999-0000")).toMatch(/Nescon/);
    expect(chamadas[0][0]).toBe("5511999990000");
    expect(chamadas[0][1]).toBe(12 * 3600);

    const dbJaAvisado = { query: async () => ({ rows: [] }) };
    expect(await ar.autoRespostaPara(dbJaAvisado, "5511999990000")).toBeNull();
  });

  it("se o banco falhar, não responde", async () => {
    const dbQuebrado = { query: async () => { throw new Error("off"); } };
    expect(await ar.autoRespostaPara(dbQuebrado, "5511999990000")).toBeNull();
  });
});
