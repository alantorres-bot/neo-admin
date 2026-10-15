"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FORMAS_PAGAMENTO, ROTULO_FORMA, type FormaPagamento } from "@/lib/modulos/rh/colaboradores/modulo";
import { lerReais, NATUREZAS, valorAPagar, type Natureza } from "@/lib/modulos/rh/folha/modulo";
import { atualizarDoCadastro, salvarItens, type ItemEditado } from "../acoes";
import type { ItemFolha } from "../../dados";

const reais = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const paraTexto = (v: number) => (v ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
const SELECAO = "h-7 rounded-[3px] border border-input bg-white px-1 text-[12px]";
const DINHEIRO = "ml-auto h-7 w-24 px-1 text-right tabular-nums";

type Editavel = { forma_pagamento: FormaPagamento; avulso_motivo: string; observacao: string } & Record<Natureza, string>;
const editavelDe = (i: ItemFolha): Editavel => ({
  forma_pagamento: i.forma_pagamento, avulso_motivo: i.avulso_motivo ?? "", observacao: i.observacao ?? "",
  liquido: paraTexto(i.liquido), ferias_acrescimos: paraTexto(i.ferias_acrescimos), decimo_terceiro: paraTexto(i.decimo_terceiro), avulso: paraTexto(i.avulso),
});

/** Grade da folha do mês: uma linha por pessoa, valores por natureza; grava as linhas alteradas de uma vez. */
export function GradeFolha({ mesId, editavel, itens }: { mesId: string; editavel: boolean; itens: ItemFolha[] }) {
  const router = useRouter();
  const [mudancas, setMudancas] = useState<Record<string, Editavel>>({});
  const [soComValor, setSoComValor] = useState(!editavel);
  const [pendente, iniciar] = useTransition();
  const alterar = (i: ItemFolha, m: Partial<Editavel>) => setMudancas((x) => ({ ...x, [i.id]: { ...(x[i.id] ?? editavelDe(i)), ...m } }));

  const linhas = useMemo(() => itens.map((i) => {
    const e = mudancas[i.id] ?? editavelDe(i);
    const v = Object.fromEntries(NATUREZAS.map((n) => [n, lerReais(e[n])])) as Record<Natureza, number>;
    const invalido = NATUREZAS.some((n) => Number.isNaN(v[n]));
    return { i, e, v, invalido, centavos: invalido ? 0 : valorAPagar(v), alterado: !!mudancas[i.id] };
  }), [itens, mudancas]);

  const totais = useMemo(() => {
    const grupos = new Map<string, number>();
    let total = 0;
    for (const { i, e, centavos, v } of linhas) {
      total += centavos;
      for (const g of [`Empresa: ${i.empregador}`, `Pagamento: ${ROTULO_FORMA[e.forma_pagamento]}`]) grupos.set(g, (grupos.get(g) ?? 0) + centavos);
      // 13º em separado do salário (pago no mês do aniversário), como a linha "13º SALÁRIO" da planilha do RH
      const partes: [string, number][] = [["Salários (líquido + férias/acréscimos)", v.liquido + v.ferias_acrescimos], ["13º salário — 1ª parcela", v.decimo_terceiro], ["Avulsos (fora da folha do escritório)", v.avulso]];
      for (const [g, x] of partes) if (x > 0) grupos.set(g, (grupos.get(g) ?? 0) + Math.round(x * 100));
    }
    return { total, grupos: [...grupos.entries()].sort() };
  }, [linhas]);

  const alteradas = linhas.filter((l) => l.alterado);
  const visiveis = soComValor ? linhas.filter((l) => l.centavos > 0 || l.alterado) : linhas;

  const salvar = () => iniciar(async () => {
    if (alteradas.some((l) => l.invalido)) { toast.error("Há valor inválido em alguma linha (use 1.234,56)."); return; }
    const envio: ItemEditado[] = alteradas.map(({ i, e, v }) => ({
      id: i.id, forma_pagamento: e.forma_pagamento, ...v, avulso_motivo: e.avulso_motivo.trim() || null, observacao: e.observacao.trim() || null,
    }));
    const r = await salvarItens(mesId, envio);
    if (!r.ok) { toast.error(r.erro); return; }
    toast.success(r.aviso ?? "Gravado.");
    setMudancas({});
    router.refresh();
  });
  const doCadastro = () => iniciar(async () => {
    if (alteradas.length) { toast.error("Salve as alterações da grade antes de atualizar do cadastro."); return; }
    const r = await atualizarDoCadastro(mesId);
    if (!r.ok) toast.error(r.erro); else { toast.success(r.aviso ?? "Atualizado."); router.refresh(); }
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-[3px] border border-grade bg-cabecalho p-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={soComValor} onChange={(e) => setSoComValor(e.target.checked)} className="size-4" />
          Só quem tem valor no mês
        </label>
        {editavel && <Button variant="outline" size="sm" onClick={doCadastro} disabled={pendente}><RefreshCw /> Atualizar do cadastro</Button>}
        {editavel && (
          <div className="ml-auto flex items-center gap-3">
            {alteradas.length > 0 && <span className="text-sm text-amber-700">{alteradas.length} linha(s) alterada(s) sem salvar</span>}
            <Button onClick={salvar} disabled={pendente || alteradas.length === 0}><Save /> {pendente ? "Salvando…" : "Salvar"}</Button>
          </div>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nº</TableHead><TableHead>Funcionário</TableHead><TableHead>Empresa</TableHead><TableHead>Pagamento</TableHead>
            <TableHead className="text-right">Líquido</TableHead><TableHead className="text-right">Férias/acréscimos</TableHead><TableHead className="text-right">13º (1ª parcela)</TableHead>
            <TableHead className="text-right">Avulso (recibos)</TableHead><TableHead>Recibos</TableHead><TableHead className="text-right">A pagar</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visiveis.map(({ i, e, centavos, alterado, invalido }) => (
            <TableRow key={i.id} className={alterado ? "bg-amber-50" : centavos === 0 ? "text-muted-foreground" : ""}>
              <TableCell className="tabular-nums">{i.cod_fornecedor}</TableCell>
              <TableCell className="font-medium">{i.nome}{i.matricula_escritorio ? <span className="ml-1 text-xs text-muted-foreground">(esc. {i.matricula_escritorio})</span> : null}</TableCell>
              <TableCell className="text-xs">{i.empregador}</TableCell>
              <TableCell>
                {editavel ? (
                  <select aria-label={`Pagamento de ${i.nome}`} value={e.forma_pagamento} onChange={(x) => alterar(i, { forma_pagamento: x.target.value as FormaPagamento })} className={SELECAO}>
                    {FORMAS_PAGAMENTO.map((f) => <option key={f} value={f}>{ROTULO_FORMA[f]}</option>)}
                  </select>
                ) : ROTULO_FORMA[e.forma_pagamento]}
              </TableCell>
              {NATUREZAS.map((n) => (
                <TableCell key={n} className="text-right tabular-nums">
                  {editavel && n !== "avulso" ? (
                    <Input aria-label={`${n} de ${i.nome}`} inputMode="decimal" value={e[n]} onChange={(x) => alterar(i, { [n]: x.target.value })}
                      aria-invalid={Number.isNaN(lerReais(e[n]))} className={DINHEIRO} />
                  ) : (i[n] ? reais(Math.round(i[n] * 100)) : "")}
                </TableCell>
              ))}
              <TableCell>
                {/* avulso e motivo vêm dos recibos avulsos do mês (0514) */}
                <span className="text-xs">{i.avulso_motivo ?? ""}</span>
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">{invalido ? "—" : reais(centavos)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Table interativa={false}>
        <TableBody>
          {totais.grupos.map(([g, c]) => (
            <TableRow key={g}><TableCell>{g}</TableCell><TableCell className="w-40 text-right tabular-nums">{reais(c)}</TableCell></TableRow>
          ))}
          <TableRow className="font-bold"><TableCell>Total a pagar no mês</TableCell><TableCell className="text-right tabular-nums">{reais(totais.total)}</TableCell></TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
