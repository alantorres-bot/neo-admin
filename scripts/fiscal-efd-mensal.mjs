// Fiscal > Créditos tributários: planilha de movimentações do mês a partir da EFD (roteiro em docs/fiscal-control/ROTEIRO_MENSAL_EFD.md).
// Lê o saldo de cada crédito no fim do mês anterior (só lançamentos efetivos) e gera as linhas que fazem o saldo do sistema
// ficar igual ao declarado. Não grava nada no banco: a planilha é importada pela tela (Importação > Movimentações).
//
// Uso (Supabase CLI logada):
//   node scripts/fiscal-efd-mensal.mjs --ref <projeto> --icms <EFD ICMS/IPI.txt> --contribuicoes <EFD-Contribuições.txt>
//        --credito ICMS=CR-2021-00004 --credito PIS=CR-2024-00006 --credito COFINS=CR-2024-00007 [--credito IPI=CR-...] [--saida <pasta>]
// Cada arquivo é opcional; só entram os tributos com --credito. Com ajuste no mês saem duas planilhas (etapa 1: créditos e ajustes;
// etapa 2: deduções), porque a dedução que depende de ajuste ainda pendente é recusada.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { apurarContribuicoes, apurarIcmsIpi } from "../lib/modulos/fiscal/creditos/efd-mensal.ts";

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const creditos = Object.fromEntries(process.argv.flatMap((a, i) => (a === "--credito" ? [process.argv[i + 1].split("=")] : [])));
const ref = arg("ref"), arqIcms = arg("icms"), arqContrib = arg("contribuicoes"), saida = arg("saida") ?? process.cwd();
if (!ref || (!arqIcms && !arqContrib) || !Object.keys(creditos).length) {
  console.error("Informe --ref, ao menos um arquivo (--icms / --contribuicoes) e os créditos (--credito ICMS=CR-...). Veja o cabeçalho do script.");
  process.exit(1);
}

/** SQL no projeto pela CLI, devolvendo as linhas (JSON). Arquivo temporário evita problemas de aspas no terminal. */
function consultar(sql) {
  const arquivo = join(tmpdir(), `neo-efd-${process.pid}.sql`);
  writeFileSync(arquivo, sql, "utf8");
  try {
    const r = spawnSync("npx", ["supabase", "db", "query", "--linked", "--project-ref", ref, "-f", `"${arquivo}"`, "--output-format", "json", "--agent", "no"],
      { shell: true, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`Falha no SQL: ${(r.stdout + r.stderr).trim().slice(0, 600)}`);
    const t = r.stdout.trim(), i = t.indexOf("[");
    return i >= 0 ? JSON.parse(t.slice(i)) : [];
  } finally { rmSync(arquivo, { force: true }); }
}

const literal = (s) => `'${String(s).replaceAll("'", "''")}'`;
function situacao(codigo, comp) {
  const [l] = consultar(`select c.id,
      coalesce(sum(m.valor_assinado) filter (where m.status = 'efetivo' and m.competencia < ${literal(comp + "-01")}::date), 0)::text saldo,
      count(m.id) filter (where m.status = 'pendente' and m.competencia < ${literal(comp + "-01")}::date) pendentes_antes,
      count(m.id) filter (where m.status <> 'rejeitado' and m.competencia = ${literal(comp + "-01")}::date) no_mes
    from fis_creditos c left join fis_movimentos m on m.credito_id = c.id
    where c.codigo = ${literal(codigo)} and not c.arquivado group by c.id`);
  if (!l) throw new Error(`Crédito ${codigo} não encontrado (ou arquivado).`);
  return { saldo: Math.round(Number(l.saldo) * 100), pendentes: Number(l.pendentes_antes), noMes: Number(l.no_mes) };
}

const ler = (f) => readFileSync(f, "latin1");
const tarefas = [];
if (arqIcms) for (const t of ["ICMS", "IPI"]) if (creditos[t]) tarefas.push({ t, f: (s) => apurarIcmsIpi(ler(arqIcms), t, s), texto: ler(arqIcms), campo: 4 });
if (arqContrib) for (const t of ["PIS", "COFINS"]) if (creditos[t]) tarefas.push({ t, f: (s) => apurarContribuicoes(ler(arqContrib), t, s), texto: ler(arqContrib), campo: 6 });

const brl = (c) => (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const linhas = [];
let erro = false;
for (const { t, f, texto, campo } of tarefas) {
  const dt = texto.split(/\r?\n/).find((l) => l.startsWith("|0000|")).split("|")[campo];
  const comp = `${dt.slice(4, 8)}-${dt.slice(2, 4)}`;
  const s = situacao(creditos[t], comp);
  if (s.noMes) { console.error(`✗ ${t}: o crédito ${creditos[t]} já tem ${s.noMes} lançamento(s) em ${comp}. Nada gerado para ele.`); erro = true; continue; }
  if (s.pendentes) console.warn(`! ${t}: ${s.pendentes} lançamento(s) pendente(s) antes de ${comp} não entram no saldo. Aprove-os antes de importar.`);
  let a;
  try { a = f(s.saldo); } catch (e) { console.error(`✗ ${t}: ${e.message}`); erro = true; continue; }
  const [ano, mes] = comp.split("-");
  const ultimo = `${new Date(Number(ano), Number(mes), 0).getDate()}/${mes}/${ano}`;
  console.log(`${t} ${mes}/${ano} (${creditos[t]}): saldo do sistema ${brl(s.saldo)} · declarado anterior ${brl(a.saldoAnteriorDeclarado)} · final declarado ${brl(a.saldoFinalDeclarado)}`);
  for (const m of a.movimentos) {
    console.log(`   ${m.tipo.padEnd(16)} ${brl(m.valor).padStart(16)}`);
    linhas.push({ etapa: m.tipo === "utilizacao" ? 2 : 1, cel: [creditos[t], m.tipo, `${mes}/${ano}`, m.tipo.startsWith("ajuste") ? `01/${mes}/${ano}` : ultimo,
      brl(m.valor), m.descricao, "", "", `${t === "PIS" || t === "COFINS" ? "EFD-Contribuições" : "EFD ICMS/IPI"} ${mes}/${ano}`] });
  }
}

const cab = ["Código do crédito", "Tipo", "Competência", "Data", "Valor", "Descrição", "Protocolo", "Processo", "Documento"];
const duasEtapas = linhas.some((l) => l.cel[1].startsWith("ajuste"));
const grupos = duasEtapas ? [[1, "etapa1-creditos-e-ajustes"], [2, "etapa2-deducoes"]] : [[0, "movimentos"]];
const comps = [...new Set(linhas.map((l) => l.cel[2].replace("/", "-")))].join("_");
for (const [etapa, nome] of grupos) {
  const sel = linhas.filter((l) => !etapa || l.etapa === etapa);
  if (!sel.length) continue;
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Importar");
  ws.addRow(cab); ws.getRow(1).font = { bold: true };
  for (const l of sel) ws.addRow(l.cel);
  const arquivo = join(saida, `efd-${comps}-${nome}.xlsx`);
  await wb.xlsx.writeFile(arquivo);
  console.log(`→ ${arquivo} (${sel.length} linhas)`);
}
if (duasEtapas) console.log("Há ajuste: importe a etapa 1, aprove os ajustes e só depois importe a etapa 2.");
process.exit(erro ? 1 : 0);
