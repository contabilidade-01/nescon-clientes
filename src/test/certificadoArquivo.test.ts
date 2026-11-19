// @vitest-environment node
/**
 * Arquivo e senha do certificado: cifra ida e volta, conferência da senha no .pfx,
 * nome do download sem senha e código por e-mail.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import arq from "../../api/src/certificadoArquivo.js";

let pfx;
beforeAll(() => {
  process.env.CERT_ENC_KEY = "chave-de-teste";
  const d = mkdtempSync(join(tmpdir(), "cert-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(d, "k.pem"),
    "-out", join(d, "c.pem"), "-days", "1", "-subj", "/CN=EMPRESA TESTE:12345678000199"], { stdio: "ignore" });
  execFileSync("openssl", ["pkcs12", "-export", "-inkey", join(d, "k.pem"), "-in", join(d, "c.pem"),
    "-out", join(d, "c.pfx"), "-passout", "pass:Teste@2026"], { stdio: "ignore" });
  pfx = readFileSync(join(d, "c.pfx"));
});

describe("cifra", () => {
  it("ida e volta do arquivo e da senha", () => {
    const c = arq.cifrar(pfx);
    expect(c.equals(pfx)).toBe(false);
    expect(arq.decifrar(c).equals(pfx)).toBe(true);
    expect(arq.decifrarTexto(arq.cifrarTexto("Teste@2026"))).toBe("Teste@2026");
  });
  it("sem chave não grava", () => {
    const antes = process.env.CERT_ENC_KEY;
    const s = process.env.SETTINGS_ENC_KEY;
    delete process.env.CERT_ENC_KEY;
    delete process.env.SETTINGS_ENC_KEY;
    expect(arq.cifraDisponivel()).toBe(false);
    expect(() => arq.cifrar(pfx)).toThrow();
    process.env.CERT_ENC_KEY = antes;
    if (s) process.env.SETTINGS_ENC_KEY = s;
  });
});

describe("conferirPfx", () => {
  it("aceita a senha certa e recusa a errada", () => {
    expect(arq.conferirPfx(pfx, "Teste@2026").ok).toBe(true);
    const errada = arq.conferirPfx(pfx, "outra");
    expect(errada.ok).toBe(false);
    expect(errada.motivo).toBe("senha_incorreta");
  });
});

describe("nomeDownload", () => {
  it("leva o CNPJ e a validade, nunca a senha", () => {
    expect(arq.nomeDownload("12.345.678/0001-99", "2027-06-03")).toBe(
      "Certificado digital 12345678000199 - vence 2027-06-03.pfx"
    );
  });
});

describe("código", () => {
  it("6 dígitos e hash por empresa", () => {
    const c = arq.gerarCodigo();
    expect(c).toMatch(/^\d{6}$/);
    expect(arq.hashCodigo("a", c)).not.toBe(arq.hashCodigo("b", c));
    expect(arq.hashCodigo("a", ` ${c} `)).toBe(arq.hashCodigo("a", c));
  });
});
