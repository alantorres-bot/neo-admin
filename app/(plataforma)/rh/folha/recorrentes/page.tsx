import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { calcularRecibo, parametrosVigentes, type Rubrica } from "@/lib/modulos/rh/folha/recibos";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerModelos, lerPessoasRecibo, lerRubricas, lerVigencias } from "../dados";
import { EditorModelo } from "./editor";

export const metadata: Metadata = { title: "Folha — recibos recorrentes" };
const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Modelos dos recibos recorrentes (gerados ao abrir a folha do mês). */
export default async function PaginaRecorrentes() {
  const sessao = await exigirSessao();
  const podeOperar = temAcesso(sessao.acesso, "rh", "operador");
  const supabase = await criarClienteServidor();
  const [modelos, pessoas, rubricas, vigencias] = await Promise.all([lerModelos(supabase), lerPessoasRecibo(supabase), lerRubricas(supabase), lerVigencias(supabase)]);
  const competencia = `${hojeEmCuiaba().slice(0, 7)}-01`;
  const catalogo = new Map<string, Rubrica>(rubricas.map((r) => [r.codigo, r]));
  const pessoa = new Map(pessoas.map((p) => [p.id, p]));
  const ativos = pessoas.filter((p) => p.ativo);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Quem recebe recibo todo mês. Ao abrir a folha do mês, o recibo de cada modelo ativo nasce pronto (com o salário do cadastro); no mês, o RH só completa o que é digitado.
        </p>
        {podeOperar && <EditorModelo pessoas={ativos} rubricas={rubricas} vigencias={vigencias} competencia={competencia} />}
      </div>
      <Table>
        <TableHeader>
          <TableRow><TableHead>Nº</TableHead><TableHead>Funcionário</TableHead><TableHead>Linhas</TableHead><TableHead className="text-right">Salário no cadastro</TableHead><TableHead className="text-right">Previsto no mês</TableHead><TableHead>Situação</TableHead>{podeOperar && <TableHead />}</TableRow>
        </TableHeader>
        <TableBody>
          {modelos.map((m) => {
            const p = pessoa.get(m.colaborador_id);
            const linhas = m.linhas.flatMap((l) => (catalogo.get(l.rubrica) ? [{ rubrica: catalogo.get(l.rubrica)!, referencia: Number(l.referencia), valor: l.valor ?? null }] : []));
            const previsto = p?.salario ? calcularRecibo(linhas, { salario: p.salario, insalubridade_pct: p.insalubridade_pct, adicional_noturno_pct: p.adicional_noturno_pct }, parametrosVigentes(vigencias, competencia)).liquido : null;
            return (
              <TableRow key={m.colaborador_id} className={m.ativo ? "" : "text-muted-foreground"}>
                <TableCell className="tabular-nums">{p?.cod_fornecedor}</TableCell>
                <TableCell className="font-medium">{p?.nome}</TableCell>
                <TableCell className="text-xs">{linhas.map((l) => `${l.rubrica.descricao} (${l.rubrica.forma === "valor" ? (l.valor ? reais(Math.round(l.valor * 100)) : "a digitar") : l.referencia.toLocaleString("pt-BR", { maximumFractionDigits: 4 })})`).join(" · ")}</TableCell>
                <TableCell className="text-right tabular-nums">{p?.salario ? reais(Math.round(p.salario * 100)) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{previsto !== null ? reais(previsto) : ""}</TableCell>
                <TableCell>{m.ativo ? <Badge variant="outline" className="border-marca text-marca">Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}</TableCell>
                {podeOperar && <TableCell><EditorModelo modelo={m} pessoas={pessoas} rubricas={rubricas} vigencias={vigencias} competencia={competencia} /></TableCell>}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
