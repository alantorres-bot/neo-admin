import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EXPLICACAO_ETAPA } from "@/lib/modulos/financeiro/filial/abas";
import { pendenciasDoKit, ROTA_FILIAL } from "@/lib/modulos/financeiro/filial/arquivos";
import { lerParcelasInformadas } from "@/lib/modulos/financeiro/filial/remessa";
import { emCentavos } from "@/lib/modulos/financeiro/recebiveis/carteira";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { sanitizarBusca } from "@/lib/nucleo/erros";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

type Etapa = "recebida" | "implantada" | "pronta" | "enviada";
type ParametrosBusca = Promise<Record<string, string | string[] | undefined>>;
const POR_PAGINA = 50;
const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Uma etapa do Faturamento Filial (mesmo formato das filas da Cobrança): busca, o que fazer, total e uma tabela com o botão
 * da tarefa em cada linha. A etapa de Cuiabá (implantar, anexar boleto) aparece para a filial como "Com Cuiabá".
 */
export async function PaginaEtapa({ etapa, caminho, searchParams }: { etapa: Etapa; caminho: string; searchParams: ParametrosBusca }) {
  const sessao = await exigirSessao();
  const ehCuiaba = temAcesso(sessao.acesso, "financeiro", "operador");
  const parametros = await searchParams;
  const busca = sanitizarBusca(primeiro(parametros.q));
  const pagina = Math.max(1, Number.parseInt(primeiro(parametros.pagina), 10) || 1);

  const supabase = await criarClienteServidor();
  let consulta = supabase.from("rec_vw_kits")
    .select("id, nota_fiscal, cliente_nome, obra, aceita_boleto_factoring, parcelas, valor_total, primeiro_vencimento, cedido, boletos, notas, demonstrativos, comodatos, cartas, exige_carta, enviado_em", { count: "exact" })
    .eq("estagio", etapa)
    .order(etapa === "enviada" ? "enviado_em" : "nota_fiscal", { ascending: etapa !== "enviada" })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  if (busca) {
    const digitos = busca.replace(/\D/g, "");
    consulta = digitos.length >= 3 && digitos.length <= 6 ? consulta.like("nota_fiscal", `%${digitos}%`) : consulta.ilike("cliente_nome", `%${busca}%`);
  }
  const { data: kits, count, error } = await consulta;
  if (error) throw new Error(`Falha ao ler os kits: ${error.message}`);
  const ids = (kits ?? []).map((k) => k.id as string);
  const [{ data: extras }, { data: remessas }] = await Promise.all([
    ids.length ? supabase.from("rec_kits").select("id, parcelas_informadas").in("id", ids) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("rec_remessa_kits").select("kit_id, rec_remessas(numero)").in("kit_id", ids) : Promise.resolve({ data: [] }),
  ]);
  const informadas = new Map((extras ?? []).map((e) => [e.id as string, lerParcelasInformadas(e.parcelas_informadas)]));
  const remessaDe = new Map<string, number>();
  for (const r of remessas ?? []) {
    const n = ((Array.isArray(r.rec_remessas) ? r.rec_remessas[0] : r.rec_remessas) as { numero?: number } | null)?.numero;
    if (n && (remessaDe.get(r.kit_id as string) ?? 0) < n) remessaDe.set(r.kit_id as string, n);
  }

  const total = count ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const valorDoKit = (k: { id: string; valor_total: number | string | null }) =>
    k.valor_total != null ? emCentavos(k.valor_total) : (informadas.get(k.id) ?? []).reduce((s, p) => s + p.valorCentavos, 0);
  const somaPagina = (kits ?? []).reduce((s, k) => s + valorDoKit(k as { id: string; valor_total: number | string | null }), 0);
  const href = (extra: { pagina?: number; q?: null }) => {
    const qs = new URLSearchParams();
    if (busca && extra.q !== null) qs.set("q", busca);
    if (extra.pagina && extra.pagina > 1) qs.set("pagina", String(extra.pagina));
    return qs.size ? `${caminho}?${qs}` : caminho;
  };
  const comCuiaba = <span className="text-[12px] text-muted-foreground">Com Cuiabá</span>;

  function acao(k: { id: string }) {
    const remessa = remessaDe.get(k.id);
    if (etapa === "recebida") {
      return ehCuiaba && remessa
        ? <Button size="sm" render={<Link href={`${ROTA_FILIAL}/remessas/${remessa}#relatorio-implantacao`} />}>Implantar</Button>
        : ehCuiaba ? <Button size="sm" variant="outline" render={<Link href={`${ROTA_FILIAL}/${k.id}`} />}>Abrir</Button> : comCuiaba;
    }
    if (etapa === "implantada") return ehCuiaba ? <Button size="sm" render={<Link href={`${ROTA_FILIAL}/boletos`} />}>Anexar boleto</Button> : comCuiaba;
    if (etapa === "pronta") return <Button size="sm" render={<Link href={`${ROTA_FILIAL}/${k.id}`} />}>Enviar ao cliente</Button>;
    return <Button size="sm" variant="outline" render={<Link href={`${ROTA_FILIAL}/${k.id}`} />}>Ver</Button>;
  }

  return (
    <div className="space-y-6">
      <form method="get" className="flex flex-wrap items-center gap-2" role="search">
        <Input name="q" defaultValue={busca} placeholder="Cliente ou nº da NF" aria-label="Buscar" className="w-72" />
        <Button type="submit" variant="secondary">Filtrar</Button>
        {busca && <Button variant="ghost" render={<Link href={href({ q: null })} />}>Limpar</Button>}
      </form>

      <p className="text-[12px] text-muted-foreground">
        {EXPLICACAO_ETAPA[etapa]}
        {total > 0 && etapa !== "enviada" && <> <strong className="text-foreground">{total} {total === 1 ? "nota" : "notas"}{totalPaginas === 1 ? ` · ${formatarMoeda(somaPagina)}` : ""}</strong>.</>}
      </p>

      {total === 0 ? (
        <p className="rounded-[3px] border border-dashed p-8 text-center text-sm text-muted-foreground">
          {busca ? "Nenhuma nota nesta etapa com a busca escolhida." : "Nada a fazer nesta etapa. Tudo em dia."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[3px] border border-grade">
          <Table className="cartoes">
            <TableHeader><TableRow>
              <TableHead>NF</TableHead><TableHead>Cliente</TableHead><TableHead>Vencimento</TableHead><TableHead className="text-right">Valor</TableHead>
              <TableHead>{etapa === "enviada" ? "Enviada em" : "Falta"}</TableHead><TableHead />
            </TableRow></TableHeader>
            <TableBody>
              {(kits ?? []).map((k) => {
                const parcelas = informadas.get(k.id) ?? [];
                const vencimento = (k.primeiro_vencimento as string | null) ?? parcelas[0]?.vencimento ?? null;
                const faltas = pendenciasDoKit({
                  estagio: etapa, notas: k.notas, demonstrativos: k.demonstrativos, comodatos: k.comodatos, cartas: k.cartas,
                  parcelas: k.parcelas ?? 0, boletos: k.boletos ?? 0, exigeCarta: !!k.exige_carta,
                });
                return (
                  <TableRow key={k.id}>
                    <TableCell className="tabular-nums font-medium"><Link className="hover:underline" href={`${ROTA_FILIAL}/${k.id}`}>{Number(k.nota_fiscal)}</Link></TableCell>
                    <TableCell className="max-w-80">
                      <span className="block truncate font-medium" title={k.cliente_nome}>{k.cliente_nome}</span>
                      {k.obra && <span className="block truncate text-[12px] text-muted-foreground" title={k.obra}>{k.obra}</span>}
                      <span className="flex flex-wrap gap-1">
                        {!k.aceita_boleto_factoring && <Badge variant="outline">Sem boleto de factoring</Badge>}
                        {k.cedido && <Badge variant="outline">AKF</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">{formatarData(vencimento)}{parcelas.length > 1 && <span className="block text-[11px] text-muted-foreground">{parcelas.length} parcelas</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatarMoeda(valorDoKit(k as { id: string; valor_total: number | string | null }))}</TableCell>
                    <TableCell className="text-[12px]">
                      {etapa === "enviada"
                        ? (k.enviado_em ? new Date(k.enviado_em as string).toLocaleDateString("pt-BR", { timeZone: "America/Cuiaba" }) : "—")
                        : faltas.length ? faltas.join(", ") : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">{acao(k as { id: string })}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-grade px-3 py-2 text-sm text-muted-foreground">
            <span>{total} {total === 1 ? "nota" : "notas"}</span>
            {totalPaginas > 1 && (
              <span className="flex items-center gap-2">
                {pagina > 1 && <Button variant="outline" size="sm" render={<Link href={href({ pagina: pagina - 1 })} />}>Anterior</Button>}
                Página {pagina} de {totalPaginas}
                {pagina < totalPaginas && <Button variant="outline" size="sm" render={<Link href={href({ pagina: pagina + 1 })} />}>Próxima</Button>}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
