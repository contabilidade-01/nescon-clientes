import { describe, expect, it } from "vitest";
import type { DragEndEvent } from "@dnd-kit/core";
import { destinoDoArraste, ehArrasteDePessoa } from "@/components/escala/ArrastarPessoa";

const ev = (active: string, over: string | null) => ({ active: { id: active }, over: over ? { id: over } : null }) as unknown as DragEndEvent;

describe("arrastar a pessoa para outra unidade", () => {
  it("pegador do nome soltado numa unidade (barra ou faixa da grade) dá pessoa e destino", () => {
    expect(destinoDoArraste(ev("pessoa:abc", "unidade:Terra Preta|barra"))).toEqual({ pessoa: "abc", destino: "Terra Preta" });
    expect(destinoDoArraste(ev("pessoa:abc", "unidade:|grade"))).toEqual({ pessoa: "abc", destino: "" });
    expect(destinoDoArraste(ev("pessoa:abc", "unidade:__fora__|barra"))).toEqual({ pessoa: "abc", destino: "__fora__" });
  });

  it("arraste de dia (célula) não é arraste de pessoa; soltar fora de unidade não move", () => {
    expect(ehArrasteDePessoa("abc|2026-12-01")).toBe(false);
    expect(destinoDoArraste(ev("abc|2026-12-01", "unidade:Q1|barra"))).toBeNull();
    expect(destinoDoArraste(ev("pessoa:abc", "def|2026-12-01"))).toBeNull();
    expect(destinoDoArraste(ev("pessoa:abc", null))).toBeNull();
  });
});
