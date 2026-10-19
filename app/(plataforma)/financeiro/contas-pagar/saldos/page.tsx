import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ehDataIso } from "@/lib/modulos/financeiro/contas-pagar/pendentes";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { carregarContasCaixa, quandoEm } from "../dados";
import { FormularioSaldos } from "./formulario-saldos";

export const metadata: Metadata = { title: "Saldos bancários" };

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const centavos = (v: number | string) => Math.round(Number(v) * 100);

type LinhaHistorico = {
  id: string; data: string; saldo: number | string; origem: string; registrado_em: string; substituido_em: string | null;
  fin_contas_bancarias: { descricao: string } | null; perfis: { nome: string } | null;
};

/**
 * Saldos bancários conciliados de cada conta da empresa, por data. É daqui que sai o caixa disponível da autorização de
 * pagamento (contas que "entram no caixa"). As contas vêm do Consistem na atualização do contas a pagar; a API não tem
 * saldo, então o financeiro registra o saldo conciliado do dia.
 */
export default async function PaginaSaldosBancarios({ searchParams }: PageProps<"/financeiro/contas-pagar/saldos">) {
  const sessao = await exigirSessao();
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");
  const ehGestor = temAcesso(sessao.acesso, "financeiro", "gestor");
  const hoje = hojeEmCuiaba();
  const parametros = await searchParams;
  const dataPedida = primeiro(parametros.data);
  const data = ehDataIso(dataPedida) && dataPedida <= hoje ? dataPedida : hoje;

  const supabase = await criarClienteServidor();
  const { data: empresasBrutas } = await supabase.from("empresas").select("id, nome_curto").eq("ativa", true).not("codigo_erp", "is", null).order("nome_curto");
  const empresas = (empresasBrutas ?? []).map((e) => ({ id: e.id as string, nome: e.nome_curto as string }));
  const empresaId = empresas.find((e) => e.id === primeiro(parametros.empresa))?.id ?? empresas[0]?.id ?? null;

  if (!empresaId) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma empresa ativa com o código do Consistem.</p>;
  }

  const [contas, { data: daData }, { data: historicoBruto }] = await Promise.all([
    carregarContasCaixa(supabase, empresaId),
    supabase.from("fin_saldos_bancarios").select("conta_id, saldo").eq("empresa_id", empresaId).eq("data", data).is("substituido_em", null),
    supabase.from("fin_saldos_bancarios")
      .select("id, data, saldo, origem, registrado_em, substituido_em, fin_contas_bancarias(descricao), perfis:registrado_por(nome)")
      .eq("empresa_id", empresaId).order("data", { ascending: false }).order("registrado_em", { ascending: false }).limit(60),
  ]);
  const saldosDaData = Object.fromEntries((daData ?? []).map((s) => [s.conta_id as string, centavos(s.saldo as number | string)]));
  const historico = (historicoBruto ?? []) as unknown as LinhaHistorico[];

  return (
    <div className="space-y-6">
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-[3px] border border-grade bg-cabecalho p-4">
        <div className="grid gap-1.5">
          <label htmlFor="saldos-empresa" className="text-sm font-medium">Empresa</label>
          <select id="saldos-empresa" name="empresa" defaultValue={empresaId} className="h-8 rounded-lg border bg-background px-2 text-sm">
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="saldos-data" className="text-sm font-medium">Data do saldo</label>
          <Input id="saldos-data" name="data" type="date" defaultValue={data} max={hoje} className="w-44" />
        </div>
        <Button type="submit" variant="outline">Abrir</Button>
        <p className="basis-full text-xs text-muted-foreground">
          Registre o saldo <strong>conciliado</strong> de cada conta. As contas marcadas em “Entra no caixa” somam o caixa disponível da autorização de pagamento;
          os depósitos esperados no dia entram na própria autorização, em “Composição”.
        </p>
      </form>

      {contas.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma conta bancária desta empresa ainda. Elas vêm do Consistem (cadastro de contas bancárias) na próxima atualização do contas a pagar.
        </p>
      ) : (
        <FormularioSaldos key={`${empresaId}-${data}`} empresaId={empresaId} data={data} hoje={hoje} contas={contas} saldosDaData={saldosDaData} podeOperar={podeOperar} ehGestor={ehGestor} />
      )}

      {historico.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-bold">Registros recentes</h2>
          <div className="overflow-x-auto rounded-[3px] border border-grade">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead>Registrado por</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historico.map((h) => (
                  <TableRow key={h.id} className={h.substituido_em ? "opacity-60" : undefined}>
                    <TableCell className="tabular-nums">{formatarData(h.data)}</TableCell>
                    <TableCell>{h.fin_contas_bancarias?.descricao ?? "—"}</TableCell>
                    <TableCell className={`text-right tabular-nums ${centavos(h.saldo) < 0 ? "text-red-700" : ""}`}>{formatarMoeda(centavos(h.saldo))}</TableCell>
                    <TableCell>{h.perfis?.nome ?? "—"} · {quandoEm(h.registrado_em)}</TableCell>
                    <TableCell>{h.substituido_em ? `substituído em ${quandoEm(h.substituido_em)}` : "vigente"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </div>
  );
}
