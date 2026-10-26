// Assinatura esperada do GED no banco (funções, privilégios, RLS e políticas) a partir das migrations do repositório. O arquivo
// scripts/ged-assinaturas.json é a referência que scripts/ged-conferir-assinaturas.mjs compara com produção, antes e depois de
// aplicar uma migration. Mudou uma migration do GED? Rode com GED_ATUALIZAR_ASSINATURAS=1 e revise o diff do JSON.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { criarBanco } from "./harness";

const ARQUIVO = join(process.cwd(), "scripts", "ged-assinaturas.json");

it("assinatura do GED nas migrations = scripts/ged-assinaturas.json", async () => {
  const db = await criarBanco();
  const sql = readFileSync(join(process.cwd(), "scripts", "ged-assinaturas.sql"), "utf8");
  const atual = (await db.query<{ assinatura: unknown }>(sql)).rows[0].assinatura;
  const texto = JSON.stringify(atual, null, 2) + "\n";
  if (process.env.GED_ATUALIZAR_ASSINATURAS === "1") writeFileSync(ARQUIVO, texto);
  expect(JSON.parse(readFileSync(ARQUIVO, "utf8"))).toEqual(atual);
}, 120_000);
