"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lerReais } from "@/lib/modulos/rh/folha/modulo";
import { calcularRecibo, type DadosPessoa, type LinhaEntrada, type Parametros, type Rubrica } from "@/lib/modulos/rh/folha/recibos";

export const reaisC = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const SELECAO = "h-8 rounded-[3px] border border-input bg-white px-2 text-[13px]";

/** Linha em edição: referência e valor como texto (vírgula decimal). */
export type LinhaEditavel = { rubrica: string; referencia: string; valor: string; descricao: string };

export const linhaVazia = (rubrica = ""): LinhaEditavel => ({ rubrica, referencia: "", valor: "", descricao: "" });
const numero = (t: string) => { const n = Number(t.replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };

/** Referência padrão ao escolher a rubrica: 30 dias, 220 horas, 1/3, 1. */
export function referenciaPadrao(r: Rubrica | undefined): string {
  if (!r) return "";
  if (r.forma === "horas") return "220";
  if (r.forma === "fracao_salario") return r.codigo === "terco_ferias" ? "0,3333" : "0,05";
  if (r.forma === "valor") return "1";
  return "30";
}

export function paraEntrada(linhas: LinhaEditavel[], catalogo: ReadonlyMap<string, Rubrica>): { ok: true; linhas: LinhaEntrada[] } | { ok: false; erro: string } {
  const saida: LinhaEntrada[] = [];
  for (const l of linhas) {
    const r = catalogo.get(l.rubrica);
    if (!r) return { ok: false, erro: "Escolha a rubrica de cada linha." };
    const ref = l.rubrica === "terco_ferias" && /^0?[,.]333/.test(l.referencia) ? 1 / 3 : numero(l.referencia || "0");
    if (Number.isNaN(ref) || ref < 0) return { ok: false, erro: `Referência inválida em ${r.descricao}.` };
    const valor = r.forma === "valor" ? lerReais(l.valor) : null;
    if (valor !== null && Number.isNaN(valor)) return { ok: false, erro: `Valor inválido em ${r.descricao}.` };
    saida.push({ rubrica: r, referencia: ref, valor });
  }
  return { ok: true, linhas: saida };
}

/** Editor das linhas de um recibo ou de um modelo recorrente (rubrica, referência e, se a forma for "valor", o valor). */
export function EditorLinhas({ linhas, mudar, rubricas, comDescricao = true }: { linhas: LinhaEditavel[]; mudar: (l: LinhaEditavel[]) => void; rubricas: Rubrica[]; comDescricao?: boolean }) {
  const porCodigo = new Map(rubricas.map((r) => [r.codigo, r]));
  const alterar = (i: number, m: Partial<LinhaEditavel>) => mudar(linhas.map((l, k) => (k === i ? { ...l, ...m } : l)));
  return (
    <div className="space-y-2">
      {linhas.map((l, i) => {
        const r = porCodigo.get(l.rubrica);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select aria-label="Rubrica" value={l.rubrica} className={`${SELECAO} w-60`}
              onChange={(e) => alterar(i, { rubrica: e.target.value, referencia: referenciaPadrao(porCodigo.get(e.target.value)) })}>
              <option value="">Rubrica…</option>
              <optgroup label="Proventos">{rubricas.filter((x) => x.natureza === "provento").map((x) => <option key={x.codigo} value={x.codigo}>{x.descricao}</option>)}</optgroup>
              <optgroup label="Descontos">{rubricas.filter((x) => x.natureza === "desconto").map((x) => <option key={x.codigo} value={x.codigo}>{x.descricao}</option>)}</optgroup>
            </select>
            <Input aria-label="Referência" value={l.referencia} onChange={(e) => alterar(i, { referencia: e.target.value })} inputMode="decimal" className="h-8 w-20 text-right"
              title={r?.forma === "horas" ? "horas" : r?.forma === "fracao_salario" ? "fração do salário" : r?.forma === "valor" ? "referência (informativa)" : "dias"} />
            <span className="w-12 text-xs text-muted-foreground">{r ? (r.forma === "horas" ? "horas" : r.forma === "fracao_salario" ? "fração" : r.forma === "valor" ? "" : "dias") : ""}</span>
            {r?.forma === "valor" && <Input aria-label="Valor" value={l.valor} onChange={(e) => alterar(i, { valor: e.target.value })} inputMode="decimal" placeholder="R$" className="h-8 w-28 text-right" />}
            {comDescricao && r?.forma === "valor" && <Input aria-label="Descrição no recibo" value={l.descricao} maxLength={60} onChange={(e) => alterar(i, { descricao: e.target.value })} placeholder={r.descricao} className="h-8 w-56" />}
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Tirar linha" onClick={() => mudar(linhas.filter((_, k) => k !== i))}><Trash2 /></Button>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={() => mudar([...linhas, linhaVazia()])}><Plus /> Linha</Button>
    </div>
  );
}

/** Prévia calculada (a mesma conta que o servidor refaz ao gravar). */
export function PreviaRecibo({ titulo, linhas, pessoa, parametros, descricoes }: { titulo?: string; linhas: LinhaEntrada[]; pessoa: DadosPessoa; parametros: Parametros; descricoes?: string[] }) {
  const c = calcularRecibo(linhas, pessoa, parametros);
  return (
    <div className="space-y-1">
      {titulo && <p className="text-sm font-medium">{titulo}</p>}
      <Table interativa={false}>
        <TableHeader><TableRow><TableHead>Rubrica</TableHead><TableHead className="text-right">Ref.</TableHead><TableHead className="text-right">Proventos</TableHead><TableHead className="text-right">Descontos</TableHead></TableRow></TableHeader>
        <TableBody>
          {c.linhas.map((l, i) => (
            <TableRow key={i}>
              <TableCell>{descricoes?.[i] || l.descricao}</TableCell>
              <TableCell className="text-right tabular-nums">{Number.isInteger(l.referencia) ? l.referencia : l.referencia.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}</TableCell>
              <TableCell className="text-right tabular-nums">{l.natureza === "provento" ? reaisC(l.centavos) : ""}</TableCell>
              <TableCell className="text-right tabular-nums">{l.natureza === "desconto" ? reaisC(l.centavos) : ""}</TableCell>
            </TableRow>
          ))}
          <TableRow className="font-bold"><TableCell colSpan={2}>Líquido</TableCell><TableCell colSpan={2} className="text-right tabular-nums">{reaisC(c.liquido)}</TableCell></TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
