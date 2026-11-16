/**
 * Fila de requisições da Cora: limite de paralelismo e repetição no HTTP 429.
 *
 * Em 27/10/2026 a sync recebeu 429 em quase todas as chamadas e terminou com 94 erros;
 * a cobrança do dia rodou sem a consulta na Cora. A fila segura o ritmo e repete
 * respeitando o Retry-After.
 */
import { describe, it, expect } from "vitest";
import { criarFila, esperaParaRepetir } from "../../api/src/cora.js";

function erro429(retryAfter?: string) {
  const err = new Error('HTTP 429: {"response-status": 429}') as Error & {
    statusCode: number;
    headers: Record<string, string>;
  };
  err.statusCode = 429;
  err.headers = retryAfter ? { "retry-after": retryAfter } : {};
  return err;
}

const semLog = () => {};

describe("esperaParaRepetir", () => {
  it("usa o Retry-After em segundos", () => {
    expect(esperaParaRepetir("3", 0)).toBe(3000);
  });

  it("aceita Retry-After como data HTTP", () => {
    const agora = Date.parse("2026-10-27T11:00:00Z");
    expect(esperaParaRepetir("Tue, 27 Oct 2026 11:00:05 GMT", 0, agora)).toBe(5000);
  });

  it("sem Retry-After, backoff exponencial com teto", () => {
    const zero = () => 0;
    expect(esperaParaRepetir(undefined, 0, 0, zero)).toBe(1000);
    expect(esperaParaRepetir(undefined, 2, 0, zero)).toBe(4000);
    expect(esperaParaRepetir(undefined, 20, 0, zero)).toBe(60000);
  });
});

describe("criarFila", () => {
  it("nunca passa do limite de paralelismo", async () => {
    const executar = criarFila({ maxParalelo: 2, intervaloMs: 0, log: semLog });
    let ativos = 0;
    let pico = 0;
    const tarefa = async () => {
      ativos++;
      pico = Math.max(pico, ativos);
      await new Promise((r) => setTimeout(r, 5));
      ativos--;
      return "ok";
    };
    const r = await Promise.all(Array.from({ length: 8 }, () => executar(tarefa)));
    expect(r).toEqual(Array(8).fill("ok"));
    expect(pico).toBe(2);
  });

  it("repete no 429 respeitando o Retry-After e devolve a resposta", async () => {
    const esperas: number[] = [];
    const executar = criarFila({
      maxParalelo: 1,
      intervaloMs: 0,
      dormir: async (ms: number) => {
        esperas.push(ms);
      },
      log: semLog,
    });
    let chamadas = 0;
    const r = await executar(async () => {
      chamadas++;
      if (chamadas < 3) throw erro429("0");
      return "detalhe";
    });
    expect(r).toBe("detalhe");
    expect(chamadas).toBe(3);
    expect(esperas).toEqual([0, 0]);
  });

  it("desiste depois das tentativas e propaga o erro", async () => {
    const executar = criarFila({ maxParalelo: 1, intervaloMs: 0, tentativas: 2, dormir: async () => {}, log: semLog });
    let chamadas = 0;
    await expect(
      executar(async () => {
        chamadas++;
        throw erro429("0");
      })
    ).rejects.toThrow("HTTP 429");
    expect(chamadas).toBe(3);
  });

  it("outros erros não são repetidos", async () => {
    const executar = criarFila({ maxParalelo: 1, intervaloMs: 0, log: semLog });
    let chamadas = 0;
    await expect(
      executar(async () => {
        chamadas++;
        throw Object.assign(new Error("HTTP 400"), { statusCode: 400 });
      })
    ).rejects.toThrow("HTTP 400");
    expect(chamadas).toBe(1);
  });
});
