/**
 * Regra de decisão da sincronização de clientes do G-Click.
 *
 * É o coração da Frente B e o lugar onde um erro custa caro nos dois sentidos: alertar
 * demais (o escritório para de ler os avisos) ou de menos (cliente novo entra sem
 * ninguém saber). Por isso a regra é uma função pura, testada sem banco.
 */
import { describe, it, expect } from "vitest";
import { decidirEventos } from "../../api/src/gclick/clientSync.js";

type LinhaEspelho = {
  cnpj: string;
  nome?: string | null;
  email?: string | null;
  phone?: string | null;
  status_gclick?: string | null;
  decisao: "pendente" | "aceito" | "rejeitado";
  company_id?: string | null;
};

const cliente = (over: Record<string, unknown> = {}) => ({
  cnpj: "11111111111111",
  name: "EMPRESA UM LTDA",
  email: "um@empresa.com",
  phone: "11999990000",
  status: "ATIVO",
  ...over,
});

const espelhoCom = (linhas: LinhaEspelho[]) => new Map(linhas.map((l) => [l.cnpj, l]));

const tipos = (r: ReturnType<typeof decidirEventos>) => r.pendencias.map((p) => p.tipo);

describe("cliente que ainda não está no espelho", () => {
  it("ativo vira alerta de cadastro", () => {
    const r = decidirEventos({ espelho: new Map(), clientes: [cliente()] });
    expect(r.inserir).toHaveLength(1);
    expect(tipos(r)).toEqual(["novo_cliente"]);
  });

  it("já desativado entra no espelho mas NÃO alerta", () => {
    const r = decidirEventos({
      espelho: new Map(),
      clientes: [cliente({ status: "DESATIVADO" })],
    });
    expect(r.inserir).toHaveLength(1);
    expect(r.pendencias).toHaveLength(0);
  });

  it("com a opção desligada, desativado também alerta", () => {
    const r = decidirEventos({
      espelho: new Map(),
      clientes: [cliente({ status: "DESATIVADO" })],
      alertaSoAtivos: false,
    });
    expect(tipos(r)).toEqual(["novo_cliente"]);
  });
});

describe("idempotência", () => {
  it("com o alerta já aberto, não abre outro", () => {
    const r = decidirEventos({
      espelho: espelhoCom([{ cnpj: "11111111111111", decisao: "pendente", status_gclick: "ATIVO" }]),
      clientes: [cliente()],
      pendenciasAbertas: new Set(["11111111111111|novo_cliente"]),
    });
    expect(r.pendencias).toHaveLength(0);
  });

  it("o mesmo CNPJ não gera dois alertas iguais na mesma passada", () => {
    const r = decidirEventos({
      espelho: espelhoCom([
        { cnpj: "11111111111111", decisao: "rejeitado", status_gclick: "DESATIVADO" },
      ]),
      clientes: [cliente()],
    });
    // Reativação de rejeitado dispara 'novo_cliente' por dois caminhos possíveis.
    expect(tipos(r)).toEqual(["novo_cliente"]);
  });
});

describe("mudança de status", () => {
  it("cliente aceito desativado vira aviso informativo", () => {
    const r = decidirEventos({
      espelho: espelhoCom([
        { cnpj: "11111111111111", decisao: "aceito", status_gclick: "ATIVO", company_id: "abc" },
      ]),
      clientes: [cliente({ status: "DESATIVADO" })],
    });
    expect(tipos(r)).toEqual(["status_alterado"]);
    expect(r.pendencias[0].dados).toMatchObject({ de: "ATIVO", para: "DESATIVADO" });
    expect(r.statusAlterado[0]).toMatchObject({ companyId: "abc", status: "DESATIVADO" });
  });

  it("sem mudança de status, não gera nada", () => {
    const r = decidirEventos({
      espelho: espelhoCom([
        { cnpj: "11111111111111", decisao: "aceito", status_gclick: "ATIVO",
          nome: "EMPRESA UM LTDA", email: "um@empresa.com", phone: "11999990000" },
      ]),
      clientes: [cliente()],
    });
    expect(r.pendencias).toHaveLength(0);
    expect(r.atualizar).toHaveLength(0);
  });

  it("mudança só de e-mail atualiza o espelho sem alertar", () => {
    const r = decidirEventos({
      espelho: espelhoCom([
        { cnpj: "11111111111111", decisao: "aceito", status_gclick: "ATIVO",
          nome: "EMPRESA UM LTDA", email: "antigo@empresa.com", phone: "11999990000" },
      ]),
      clientes: [cliente()],
    });
    expect(r.atualizar).toHaveLength(1);
    expect(r.pendencias).toHaveLength(0);
  });
});

describe("rejeitados", () => {
  it("rejeitado que continua igual não incomoda mais ninguém", () => {
    const r = decidirEventos({
      espelho: espelhoCom([
        { cnpj: "11111111111111", decisao: "rejeitado", status_gclick: "ATIVO",
          nome: "EMPRESA UM LTDA", email: "um@empresa.com", phone: "11999990000" },
      ]),
      clientes: [cliente()],
    });
    expect(r.pendencias).toHaveLength(0);
  });

  it("rejeitado que volta a ficar ativo é reperguntado", () => {
    const r = decidirEventos({
      espelho: espelhoCom([
        { cnpj: "11111111111111", decisao: "rejeitado", status_gclick: "DESATIVADO" },
      ]),
      clientes: [cliente({ status: "ATIVO" })],
    });
    expect(tipos(r)).toEqual(["novo_cliente"]);
  });
});

describe("herança do backfill", () => {
  it("linha pendente da primeira carga é alertada, mesmo já estando no espelho", () => {
    // Sem esta regra o cliente ficaria invisível para sempre: já está no espelho,
    // então nunca cairia no ramo "não existe".
    const r = decidirEventos({
      espelho: espelhoCom([
        { cnpj: "11111111111111", decisao: "pendente", status_gclick: "ATIVO",
          nome: "EMPRESA UM LTDA", email: "um@empresa.com", phone: "11999990000" },
      ]),
      clientes: [cliente()],
    });
    expect(tipos(r)).toEqual(["novo_cliente"]);
    expect(r.inserir).toHaveLength(0);
  });

  it("empresa já aceita no backfill não vira alerta", () => {
    const r = decidirEventos({
      espelho: espelhoCom([
        { cnpj: "11111111111111", decisao: "aceito", status_gclick: "ATIVO",
          nome: "EMPRESA UM LTDA", email: "um@empresa.com", phone: "11999990000" },
      ]),
      clientes: [cliente()],
    });
    expect(r.pendencias).toHaveLength(0);
  });
});

it("cliente sem CNPJ é ignorado", () => {
  const r = decidirEventos({ espelho: new Map(), clientes: [cliente({ cnpj: "" })] });
  expect(r.inserir).toHaveLength(0);
  expect(r.pendencias).toHaveLength(0);
});
