import { describe, it, expect } from "vitest";
import { paginasRestantes } from "../../api/src/gclick/client.js";

describe("paginasRestantes da listagem G-Click", () => {
  it("índice 0 (Spring): páginas 1..N-1", () => {
    expect(paginasRestantes(0, 5)).toEqual([1, 2, 3, 4]);
  });

  it("índice 1 (doc Postman): páginas 2..N", () => {
    expect(paginasRestantes(1, 5)).toEqual([2, 3, 4, 5]);
  });

  it("uma página só não pede mais nada", () => {
    expect(paginasRestantes(0, 1)).toEqual([]);
    expect(paginasRestantes(1, 1)).toEqual([]);
  });
});
