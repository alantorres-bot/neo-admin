import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MODULO_COMISSOES, ROTA_COMISSOES } from "@/lib/modulos/financeiro/comissoes/regras";
import { formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { formatarData, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { AbrirFechamento } from "./componentes";
import { rotuloCompetencia, totaisDoRepresentante, type LinhaFechamento } from "./dados";

export const metadata: Metadata = { title: "Comissões" };

export default async function PaginaComissoes() {
  const sessao = await exigirSessao();
  const ehOperador = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_COMISSOES, "operador");
  const supabase = await criarClienteServidor();
  const [{ data: fechamentos }, { data: linhas }, { data: reps }] = await Promise.all([
    supabase.from("fin_com_fechamentos").select("id, competencia, status, fechado_em").order("competencia", { ascending: false }),
    supabase.from("fin_com_linhas").select("fechamento_id, cod_representante, origem, incluida, valor_comissao"),
    supabase.from("fin_com_representantes").select("cod_representante, nome").order("cod_representante"),
  ]);
  const hoje = hojeEmCuiaba();
  const [a, m] = [Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))];
  const mesAnterior = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
  const nomes = new Map((reps ?? []).map((r) => [r.cod_representante as string, r.nome as string]));

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Comissões</h1>
          <p className="text-sm text-muted-foreground">
            Fechamento mensal da comissão dos representantes: créditos da CCCCI010, títulos pagos no mês (Consistem), conferência e fechamento.
          </p>
        </div>
        <Link href={`${ROTA_COMISSOES}/representantes`} className="text-sm underline underline-offset-4">Representantes e percentuais</Link>
      </div>

      {ehOperador && (
        <Card>
          <CardHeader>
            <CardTitle>Novo fechamento</CardTitle>
            <CardDescription>Escolha o mês de referência (parcelas pagas no mês). Se o mês já tiver fechamento, ele é aberto.</CardDescription>
          </CardHeader>
          <CardContent><AbrirFechamento mesPadrao={mesAnterior} /></CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Fechamentos</CardTitle></CardHeader>
        <CardContent>
          {(fechamentos ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum fechamento ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead>Situação</TableHead>
                  {[...nomes.values()].map((n) => <TableHead key={n} className="text-right">{n}</TableHead>)}
                  <TableHead>Fechado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(fechamentos ?? []).map((f) => (
                  <TableRow key={f.id}>
                    <TableCell><Link href={`${ROTA_COMISSOES}/${f.id}`} className="font-medium underline-offset-4 hover:underline">{rotuloCompetencia(f.competencia)}</Link></TableCell>
                    <TableCell><Badge variant={f.status === "fechado" ? "secondary" : "outline"}>{f.status === "fechado" ? "Fechado" : "Em conferência"}</Badge></TableCell>
                    {[...nomes.keys()].map((cod) => {
                      const ls = (linhas ?? []).filter((l) => l.fechamento_id === f.id && l.cod_representante === cod) as Pick<LinhaFechamento, "incluida" | "origem" | "valor_comissao">[];
                      return <TableCell key={cod} className="text-right tabular-nums">{ls.length ? formatarMoeda(totaisDoRepresentante(ls).saldo) : "—"}</TableCell>;
                    })}
                    <TableCell className="tabular-nums">{formatarData(f.fechado_em)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
