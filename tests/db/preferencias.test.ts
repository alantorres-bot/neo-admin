import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { como, criarBanco, novoUsuario, type Linha } from "./harness";

let db: PGlite;
let ana: string, bia: string;

const q = (sql: string, p: unknown[] = []) => db.query<Linha>(sql, p);
const CHAVE = "recebiveis.ocultar_vencidos_90";

const gravar = (usuario: string, perfil: string, valor: unknown) =>
  como(db, usuario, () => q(
    `insert into preferencias_usuario (perfil_id, chave, valor) values ($1, $2, $3::jsonb)
     on conflict (perfil_id, chave) do update set valor = excluded.valor`, [perfil, CHAVE, JSON.stringify(valor)]));
const ler = (usuario: string) => como(db, usuario, () => q(`select perfil_id, valor from preferencias_usuario where chave = $1`, [CHAVE]));

beforeAll(async () => {
  db = await criarBanco();
  await novoUsuario(db, "admin@neo.com"); // o primeiro usuário vira admin_geral (migration 0003)
  ana = await novoUsuario(db, "ana@neo.com", { financeiro: "consulta" });
  bia = await novoUsuario(db, "bia@neo.com", { financeiro: "consulta" });
});

describe("preferencias_usuario", () => {
  it("cada usuário grava e atualiza a própria preferência (upsert)", async () => {
    await gravar(ana, ana, true);
    expect((await ler(ana)).rows).toEqual([{ perfil_id: ana, valor: true }]);
    await gravar(ana, ana, false);
    expect((await ler(ana)).rows).toEqual([{ perfil_id: ana, valor: false }]);
  });

  it("uma pessoa não vê a preferência de outra", async () => {
    await gravar(ana, ana, true);
    expect((await ler(bia)).rows).toEqual([]);
    await gravar(bia, bia, false);
    expect((await ler(bia)).rows).toEqual([{ perfil_id: bia, valor: false }]);
    expect((await ler(ana)).rows).toEqual([{ perfil_id: ana, valor: true }]);
  });

  it("não é possível gravar a preferência de outra pessoa", async () => {
    await expect(gravar(ana, bia, true)).rejects.toThrow();
  });

  it("não há exclusão", async () => {
    await gravar(ana, ana, true);
    await como(db, ana, () => q(`delete from preferencias_usuario where perfil_id = $1`, [ana]));
    expect((await ler(ana)).rows).toHaveLength(1);
  });

  it("a chave não pode ser vazia", async () => {
    await expect(como(db, ana, () => q(`insert into preferencias_usuario (perfil_id, chave, valor) values ($1, '', 'true')`, [ana]))).rejects.toThrow();
  });
});
