#!/usr/bin/env node
/**
 * Decifra um backup do portal e devolve o .sql pronto para restaurar.
 *
 * Este arquivo mora no repositório de propósito. O formato do backup documentado só num
 * comentário do servidor seria a melhor forma de perder o backup junto com o servidor —
 * e é exatamente no dia em que o servidor se perde que alguém precisa deste script.
 *
 * Uso:
 *   node scripts/restaurar-backup.cjs portal-2026-08-05.sql.gz.enc
 *   node scripts/restaurar-backup.cjs arquivo.enc --senha "a senha do backup"
 *
 * Sem --senha, ele pergunta (não fica no histórico do shell).
 *
 * Depois, para restaurar de verdade:
 *   psql -h HOST -U rhapp -d rhapp < portal-2026-08-05.sql
 *
 * Restaurar por cima de um banco com dados exige um banco VAZIO — o dump recria as
 * tabelas, não mescla. Em produção: criar um banco novo, restaurar nele, conferir os
 * números, e só então apontar a aplicação.
 */
const crypto = require("crypto");
const fs = require("fs");
const zlib = require("zlib");
const readline = require("readline");

const MAGIC = Buffer.from("NESCONBK1");

function decifrar(buffer, senha) {
  if (buffer.length < MAGIC.length + 44) throw new Error("Arquivo pequeno demais para ser um backup.");
  if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Assinatura não confere — este arquivo não é um backup do portal.");
  }
  let p = MAGIC.length;
  const salt = buffer.subarray(p, (p += 16));
  const iv = buffer.subarray(p, (p += 12));
  const tag = buffer.subarray(p, (p += 16));
  const chave = crypto.scryptSync(senha, salt, 32);
  const d = crypto.createDecipheriv("aes-256-gcm", chave, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buffer.subarray(p)), d.final()]);
}

function perguntarSenha() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Senha do backup: ", (resposta) => {
      rl.close();
      resolve(resposta);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const entrada = args.find((a) => !a.startsWith("--"));
  if (!entrada) {
    console.error("Uso: node scripts/restaurar-backup.cjs <arquivo.enc> [--senha SENHA]");
    process.exit(1);
  }
  if (!fs.existsSync(entrada)) {
    console.error(`Arquivo não encontrado: ${entrada}`);
    process.exit(1);
  }

  const i = args.indexOf("--senha");
  const senha = i >= 0 ? args[i + 1] : await perguntarSenha();
  if (!senha) {
    console.error("Sem senha não há como abrir o arquivo.");
    process.exit(1);
  }

  let sql;
  try {
    const comprimido = decifrar(fs.readFileSync(entrada), senha);
    sql = zlib.gunzipSync(comprimido);
  } catch (err) {
    // A causa quase sempre é senha errada: o GCM falha a autenticação antes de decifrar.
    console.error(`Não consegui abrir: ${err.message}`);
    console.error("Se a assinatura conferiu, a senha está errada.");
    process.exit(1);
  }

  const saida = entrada.replace(/\.gz\.enc$|\.enc$/, "") + (entrada.includes(".sql") ? "" : ".sql");
  fs.writeFileSync(saida, sql);

  const texto = sql.toString("utf8");
  const completo = /PostgreSQL database dump complete/i.test(texto);
  const tabelas = (texto.match(/CREATE TABLE public\.(\w+)/g) || []).length;

  console.log(`\nPronto: ${saida}`);
  console.log(`  ${(sql.length / 1024 / 1024).toFixed(1)} MB · ${tabelas} tabelas`);
  console.log(`  ${completo ? "dump completo" : "ATENÇÃO: sem a marca de conclusão — pode estar truncado"}`);
  console.log(`\nPara restaurar num banco VAZIO:`);
  console.log(`  psql -h HOST -U rhapp -d NOME_DO_BANCO < ${saida}`);
}

main();
