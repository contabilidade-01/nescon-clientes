import { describe, it, expect } from "vitest";
import { mascararEmail } from "../../api/src/emailMascara.js";

describe("mascararEmail (padrão dos bancos)", () => {
  it("mostra 2 letras do nome e do domínio e mantém o final", () => {
    expect(mascararEmail("joao.silva@gmail.com")).toBe("jo•••••@gm•••.com");
    expect(mascararEmail("Contato@Nescon.com.br")).toBe("co•••••@ne•••.com.br");
  });

  it("nome e domínio curtos mostram só a 1ª letra", () => {
    expect(mascararEmail("ana@uol.com.br")).toBe("a•••••@u•••.com.br");
  });

  it("não revela o tamanho do nome (pontos fixos)", () => {
    expect(mascararEmail("abcdefghijklmno@gmail.com")).toBe(mascararEmail("abcde@gmail.com")!.replace("ab", "ab"));
  });

  it("e-mail inválido ou ausente devolve null", () => {
    expect(mascararEmail(null)).toBeNull();
    expect(mascararEmail("sem-arroba")).toBeNull();
    expect(mascararEmail("@dominio.com")).toBeNull();
  });
});
