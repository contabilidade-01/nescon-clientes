/**
 * Conferência entre o SQL escrito nas rotas e o schema que o sistema cria.
 *
 * Nenhum teste nosso sobe um Postgres — todos são de função pura. Isso deixa um buraco
 * conhecido: um nome de coluna errado ou um INSERT com número de parâmetros trocado só
 * apareceria em produção. Este teste fecha a parte mais barata desse buraco: ele lê os
 * `ensure*.js` e o `init.sql`, monta o schema esperado e confere **todo INSERT e todo
 * UPDATE ... SET** do código contra ele.
 *
 * Não substitui um teste com banco de verdade (que continua na lista), mas pega a
 * classe de erro mais comum: escrever numa coluna que não existe.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../..");

function arquivos(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...arquivos(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

/** Colunas de cada tabela, vindas dos CREATE TABLE e dos ALTER TABLE ADD COLUMN. */
function lerSchema(): Map<string, Set<string>> {
  const schema = new Map<string, Set<string>>();
  const fontes = [
    ...arquivos(path.join(RAIZ, "api/src"), ".js").filter((f) => /ensure|Schema/i.test(path.basename(f))),
    path.join(RAIZ, "db/init.sql"),
  ];

  for (const f of fontes) {
    const txt = fs.readFileSync(f, "utf8");

    // O bloco fecha de dois jeitos: `);` no init.sql (SQL solto) e `)` seguido da crase
    // de fechamento do template literal nos ensure*.js (ex.: `      )\n    `);`). O regex
    // antigo só casava o primeiro — por isso tabelas definidas só nos ensure*.js (chat,
    // alertas, engagement…) entravam vazias e davam falso "coluna inexistente".
    for (const m of txt.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\s*\)\s*(?:;|`)/g)) {
      const tabela = m[1];
      const cols = schema.get(tabela) ?? new Set<string>();
      for (const linha of m[2].split("\n")) {
        const c = /^\s*([a-z_]+)\s+[A-Z]/.exec(linha);
        if (c && !["unique", "check", "primary", "foreign", "constraint"].includes(c[1])) {
          cols.add(c[1]);
        }
      }
      schema.set(tabela, cols);
    }

    for (const m of txt.matchAll(/ALTER TABLE (\w+)\s+ADD COLUMN IF NOT EXISTS (\w+)/g)) {
      const cols = schema.get(m[1]) ?? new Set<string>();
      cols.add(m[2]);
      schema.set(m[1], cols);
    }
  }
  return schema;
}

const schema = lerSchema();
const fontesApi = arquivos(path.join(RAIZ, "api/src"), ".js");

describe("schema esperado", () => {
  it("as tabelas principais foram reconhecidas", () => {
    for (const t of [
      "companies",
      "employees",
      "deliverables",
      "company_licenses",
      "annual_tax_receipts",
      "gclick_clients",
      "gclick_pendencias",
      "employee_exit_alerts",
      "vacation_uploads",
      "vacation_periods",
      "platform_admins",
      "app_settings",
    ]) {
      expect(schema.has(t), `tabela ${t} não encontrada no schema`).toBe(true);
    }
  });
});

describe("INSERT: toda coluna escrita existe", () => {
  it("nenhuma coluna inventada", () => {
    const erros: string[] = [];
    for (const f of fontesApi) {
      const txt = fs.readFileSync(f, "utf8");
      for (const m of txt.matchAll(/INSERT INTO (\w+)\s*\(([^)]*)\)/g)) {
        const tabela = m[1];
        if (!schema.has(tabela)) continue; // tabela de outro módulo/legado
        for (const bruto of m[2].split(",")) {
          const col = bruto.trim().replace(/\s+/g, " ");
          if (!col) continue;
          if (!schema.get(tabela)!.has(col)) {
            erros.push(`${path.relative(RAIZ, f)}: ${tabela}.${col}`);
          }
        }
      }
    }
    expect(erros, `colunas inexistentes:\n${erros.join("\n")}`).toEqual([]);
  });

  it("número de colunas bate com o de valores", () => {
    const erros: string[] = [];
    for (const f of fontesApi) {
      const txt = fs.readFileSync(f, "utf8");
      for (const m of txt.matchAll(/INSERT INTO (\w+)\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*?)\)\s*(?:ON CONFLICT|RETURNING|`|\))/g)) {
        const nCols = m[2].split(",").filter((c) => c.trim()).length;
        // Conta os valores no topo: vírgulas dentro de CASE/função não contam.
        // Em INSERT de várias linhas — VALUES (..),(..),(..) — basta conferir a
        // PRIMEIRA tupla: as demais têm a mesma aridade, e somar todas acusaria
        // desequilíbrio onde não há (era o falso-positivo do seed de acompanhamentos).
        const valores = m[3].split(/\)\s*,\s*\(/)[0];
        let nivel = 0;
        let nVals = 1;
        for (const ch of valores) {
          if (ch === "(") nivel++;
          else if (ch === ")") nivel--;
          else if (ch === "," && nivel === 0) nVals++;
        }
        if (nCols !== nVals) {
          erros.push(`${path.relative(RAIZ, f)}: ${m[1]} → ${nCols} colunas, ${nVals} valores`);
        }
      }
    }
    expect(erros, `INSERT desbalanceado:\n${erros.join("\n")}`).toEqual([]);
  });
});

describe("UPDATE: toda coluna atribuída existe", () => {
  it("nenhuma coluna inventada", () => {
    const erros: string[] = [];
    for (const f of fontesApi) {
      const txt = fs.readFileSync(f, "utf8");
      for (const m of txt.matchAll(/UPDATE (\w+)[\s\S]{0,40}?\bSET\b([\s\S]*?)(?:\bWHERE\b|`)/g)) {
        const tabela = m[1];
        if (!schema.has(tabela)) continue;
        for (const atrib of m[2].split(",")) {
          const c = /^\s*([a-z_]+)\s*=/.exec(atrib);
          if (c && !schema.get(tabela)!.has(c[1])) {
            erros.push(`${path.relative(RAIZ, f)}: ${tabela}.${c[1]}`);
          }
        }
      }
    }
    expect(erros, `colunas inexistentes em UPDATE:\n${erros.join("\n")}`).toEqual([]);
  });
});
