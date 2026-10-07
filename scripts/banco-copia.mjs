// Cópia de segurança e restauração dos DADOS do Neo Admin, sem Docker e sem `pg_dump`: usa `supabase db query` (API de
// gerenciamento, com o login da CLI) em JSON. O esquema (tabelas, funções, policies) NÃO é copiado aqui: ele vem das migrations
// (`supabase db push`). Aqui vão só as linhas das tabelas de `public` e os usuários do login (`auth.users`/`auth.identities`).
//
// Uso (na pasta do projeto, com a CLI logada):
//   node scripts/banco-copia.mjs exportar  --ref <ref>  [--pasta <pasta>]      grava um .json por tabela + manifesto com contagens
//   node scripts/banco-copia.mjs conferir  --ref <ref>  --pasta <pasta>        compara a contagem de cada tabela com a cópia
//   node scripts/banco-copia.mjs importar  --ref <ref>  --pasta <pasta> --sim  APAGA as tabelas de public do destino e restaura
//
// Segurança: o `importar` exige `--sim` e recusa rodar se o destino for o mesmo projeto da cópia. As cópias contêm dados
// financeiros e hashes de senha: guarde a pasta num lugar privado (nunca no Git; `backups/` já está no .gitignore).
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TAMANHO_LOTE = 150; // linhas por chamada de importação
const TABELAS_AUTH = ["users", "identities"];

function argumento(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : padrao;
}
const tem = (nome) => process.argv.includes(`--${nome}`);
const aspas = (s) => `"${s}"`;

/** Roda um SQL no projeto e devolve as linhas (JSON). O arquivo temporário evita problemas de aspas no terminal. */
function consultar(ref, sql) {
  const arquivo = join(tmpdir(), `neo-copia-${process.pid}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(arquivo, sql, "utf8");
  try {
    const r = spawnSync("npx", ["supabase", "db", "query", "--linked", "--project-ref", ref, "-f", aspas(arquivo), "--output-format", "json", "--agent", "no"], {
      shell: true, encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    });
    if (r.status !== 0) throw new Error(`Falha no SQL: ${(r.stdout + r.stderr).trim().slice(0, 600)}`);
    const texto = r.stdout.trim();
    if (!texto) return [];
    const inicio = texto.indexOf("[");
    return inicio >= 0 ? JSON.parse(texto.slice(inicio)) : [];
  } finally {
    rmSync(arquivo, { force: true });
  }
}

const identificador = (s) => `"${s.replaceAll('"', '""')}"`;

/** Tabelas de `public` (sem views) e as de `auth` que levamos, com as colunas que dá para inserir (sem as geradas). */
function descobrirTabelas(ref) {
  const tabelas = consultar(ref, `select table_schema as esquema, table_name as tabela from information_schema.tables
    where table_type = 'BASE TABLE' and ((table_schema = 'public') or (table_schema = 'auth' and table_name in (${TABELAS_AUTH.map((t) => `'${t}'`).join(",")})))
    order by table_schema desc, table_name`);
  const colunas = consultar(ref, `select table_schema as esquema, table_name as tabela, column_name as coluna, is_generated as gerada, identity_generation as identidade
    from information_schema.columns where (table_schema = 'public') or (table_schema = 'auth' and table_name in (${TABELAS_AUTH.map((t) => `'${t}'`).join(",")}))
    order by table_schema, table_name, ordinal_position`);
  return tabelas.map((t) => ({
    ...t,
    colunas: colunas.filter((c) => c.esquema === t.esquema && c.tabela === t.tabela && c.gerada !== "ALWAYS" && c.identidade !== "ALWAYS").map((c) => c.coluna),
  }));
}

const arquivoDaTabela = (pasta, t) => join(pasta, `${t.esquema}.${t.tabela}.json`);

function exportar() {
  const ref = argumento("ref");
  if (!ref) throw new Error("Informe --ref <ref do projeto>.");
  const agora = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const pasta = argumento("pasta", join(process.cwd(), "backups", `${ref}-${agora}`));
  mkdirSync(pasta, { recursive: true });
  const tabelas = descobrirTabelas(ref);
  const manifesto = { ref, criadoEm: new Date().toISOString(), tabelas: [] };
  for (const t of tabelas) {
    const linhas = consultar(ref, `select * from ${identificador(t.esquema)}.${identificador(t.tabela)}`);
    writeFileSync(arquivoDaTabela(pasta, t), JSON.stringify(linhas), "utf8");
    manifesto.tabelas.push({ esquema: t.esquema, tabela: t.tabela, linhas: linhas.length, colunas: t.colunas });
    console.log(`${String(linhas.length).padStart(6)}  ${t.esquema}.${t.tabela}`);
  }
  writeFileSync(join(pasta, "_manifesto.json"), JSON.stringify(manifesto, null, 2), "utf8");
  console.log(`\nCópia gravada em: ${pasta}`);
}

function lerManifesto(pasta) {
  return JSON.parse(readFileSync(join(pasta, "_manifesto.json"), "utf8"));
}

function conferir() {
  const ref = argumento("ref");
  const pasta = argumento("pasta");
  if (!ref || !pasta) throw new Error("Informe --ref e --pasta.");
  const manifesto = lerManifesto(pasta);
  let diferencas = 0;
  for (const t of manifesto.tabelas) {
    const [{ n }] = consultar(ref, `select count(*)::int as n from ${identificador(t.esquema)}.${identificador(t.tabela)}`);
    const ok = n === t.linhas;
    if (!ok) diferencas++;
    console.log(`${ok ? "OK       " : "DIFERENTE"}  ${String(t.linhas).padStart(6)} -> ${String(n).padStart(6)}  ${t.esquema}.${t.tabela}`);
  }
  console.log(diferencas === 0 ? "\nTodas as contagens batem." : `\n${diferencas} tabela(s) com contagem diferente.`);
  process.exitCode = diferencas === 0 ? 0 : 1;
}

function importar() {
  const ref = argumento("ref");
  const pasta = argumento("pasta");
  if (!ref || !pasta) throw new Error("Informe --ref (DESTINO) e --pasta.");
  if (!tem("sim")) throw new Error("O importar APAGA as tabelas de public do destino. Confirme com --sim.");
  const manifesto = lerManifesto(pasta);
  if (manifesto.ref === ref) throw new Error("O destino é o mesmo projeto da cópia: nada a restaurar.");

  // Só as colunas que existem nos DOIS lados e podem ser inseridas (o destino pode ter colunas a mais, ex.: versão nova do Auth).
  const destino = descobrirTabelas(ref);
  const publicas = destino.filter((t) => t.esquema === "public").map((t) => `${identificador(t.esquema)}.${identificador(t.tabela)}`);
  console.log(`Apagando ${publicas.length} tabelas de public no destino ${ref}...`);
  consultar(ref, `set session_replication_role = replica; truncate table ${publicas.join(", ")} restart identity cascade;`);
  consultar(ref, `set session_replication_role = replica; delete from auth.identities; delete from auth.users;`);

  for (const t of manifesto.tabelas) {
    const alvo = destino.find((d) => d.esquema === t.esquema && d.tabela === t.tabela);
    if (!alvo) { console.log(`PULADA (não existe no destino): ${t.esquema}.${t.tabela}`); continue; }
    const colunas = t.colunas.filter((c) => alvo.colunas.includes(c));
    const linhas = JSON.parse(readFileSync(arquivoDaTabela(pasta, t), "utf8"));
    const lista = colunas.map(identificador).join(", ");
    const nome = `${identificador(t.esquema)}.${identificador(t.tabela)}`;
    for (let i = 0; i < linhas.length; i += TAMANHO_LOTE) {
      const lote = JSON.stringify(linhas.slice(i, i + TAMANHO_LOTE)).replaceAll("$neo$", "$ neo $");
      // jsonb_populate_recordset converte texto, datas, arrays e jsonb para os tipos da tabela; com triggers e chaves
      // estrangeiras desligados (replica) a ordem das tabelas não importa e o histórico (auditoria) não é duplicado.
      consultar(ref, `set session_replication_role = replica; insert into ${nome} (${lista}) select ${lista} from jsonb_populate_recordset(null::${nome}, $neo$${lote}$neo$::jsonb);`);
    }
    console.log(`${String(linhas.length).padStart(6)}  ${t.esquema}.${t.tabela}`);
  }
  console.log("\nImportação concluída. Rode `conferir` para comparar as contagens.");
}

const comandos = { exportar, conferir, importar };
const comando = process.argv[2];
if (!comandos[comando]) {
  console.error("Uso: node scripts/banco-copia.mjs <exportar|conferir|importar> --ref <ref> [--pasta <pasta>] [--sim]");
  process.exit(2);
}
try {
  comandos[comando]();
} catch (e) {
  console.error(`\nERRO: ${e.message}`);
  process.exit(1);
}
