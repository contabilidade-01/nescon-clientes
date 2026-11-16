import { describe, expect, it } from "vitest";
import { linkAvulso } from "@/components/LinkAvulsoCard";

describe("link sem login de advertência/suspensão", () => {
  it("aponta para /avulso, sem CNPJ embutido", () => {
    expect(linkAvulso("https://portal.exemplo.com.br")).toBe("https://portal.exemplo.com.br/avulso");
    expect(linkAvulso("https://portal.exemplo.com.br/")).toBe("https://portal.exemplo.com.br/avulso");
  });
});
