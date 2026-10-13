import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  COR_ESTAGIO_KIT as COR_ESTAGIO, ehEstagioKit, ESTAGIOS_KIT, MODULO_FILIAL, pendenciasDoKit, ROTA_FILIAL, ROTULO_ESTAGIO_KIT, type EstagioKit,
} from "@/lib/modulos/financeiro/filial/arquivos";
import { emCentavos } from "@/lib/modulos/financeiro/recebiveis/carteira";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Faturamento Filial" };

const ABERTOS: EstagioKit[] = ["recebida", "implantada", "pronta"];
const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PaginaFilial({ searchParams }: PageProps<"/financeiro/filial">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_FILIAL);
  if (!modulo || !modulo.ativo || !temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_FILIAL)) notFound();
  const podeOperar = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_FILIAL, "operador");

  const pedido = primeiro((await searchParams).estagio);
  const estagio = ehEstagioKit(pedido) ? pedido : null;

  const supabase = await criarClienteServidor();
  let consulta = supabase.from("rec_vw_kits")
    .select("id, nota_fiscal, cliente_nome, obra, estagio, aceita_boleto_factoring, parcelas, valor_total, primeiro_vencimento, cedido, boletos, notas, demonstrativos, comodatos, cartas, exige_carta, criado_em")
    .order("nota_fiscal", { ascending: false }).limit(300);
  consulta = estagio ? consulta.eq("estagio", estagio) : consulta.in("estagio", ABERTOS);
  const [{ data: kits, error }, { data: contagem }] = await Promise.all([
    consulta,
    supabase.from("rec_kits").select("estagio").in("estagio", ABERTOS),
  ]);
  if (error) throw new Error(`Falha ao ler os kits: ${error.message}`);
  const total = (e: EstagioKit) => (contagem ?? []).filter((k) => k.estagio === e).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Faturamento Filial Contagem</h1>
          <p className="text-sm text-muted-foreground">
            Cada NF emitida no Syslock vira um kit: a filial sobe a nota fatura, o demonstrativo e o comodato; Cuiabá implanta no Consistem
            e anexa o boleto (e a carta de cessão, se o título foi cedido e o cliente pede a carta); com tudo pronto, a filial envia ao cliente.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" render={<Link href={`${ROTA_FILIAL}/remessas`} />}>Remessas</Button>
          {sessao.acesso.restrito ? null : podeOperar && <Button variant="outline" render={<Link href={`${ROTA_FILIAL}/boletos`} />}>Anexar boletos</Button>}
          {podeOperar && <Button render={<Link href={`${ROTA_FILIAL}/enviar`} />}>Enviar faturas</Button>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {ABERTOS.map((e) => (
          <Link key={e} href={`${ROTA_FILIAL}?estagio=${e}`}>
            <Card size="sm" className={estagio === e ? "border-marca" : undefined}>
              <CardHeader><CardDescription>{ROTULO_ESTAGIO_KIT[e]}</CardDescription><CardTitle className="text-xl tabular-nums">{total(e)}</CardTitle></CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      <nav className="flex flex-wrap gap-2 text-[13px]" aria-label="Filtrar por estágio">
        <Link className={estagio === null ? "font-semibold underline" : "underline-offset-2 hover:underline"} href={ROTA_FILIAL}>Em andamento</Link>
        {ESTAGIOS_KIT.map((e) => (
          <Link key={e} className={estagio === e ? "font-semibold underline" : "underline-offset-2 hover:underline"} href={`${ROTA_FILIAL}?estagio=${e}`}>{ROTULO_ESTAGIO_KIT[e]}</Link>
        ))}
      </nav>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>NF</TableHead><TableHead>Cliente</TableHead><TableHead>Estágio</TableHead><TableHead>Falta</TableHead>
            <TableHead className="text-right">Valor</TableHead><TableHead>1º vencimento</TableHead><TableHead>Registrada</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(kits ?? []).length === 0 && <TableRow><TableCell colSpan={7} className="text-muted-foreground">Nenhum kit neste filtro.</TableCell></TableRow>}
          {(kits ?? []).map((k) => {
            const e = k.estagio as EstagioKit;
            const faltas = pendenciasDoKit({
              estagio: e, notas: k.notas, demonstrativos: k.demonstrativos, comodatos: k.comodatos, cartas: k.cartas,
              parcelas: k.parcelas ?? 0, boletos: k.boletos ?? 0, exigeCarta: !!k.exige_carta,
            });
            return (
              <TableRow key={k.id}>
                <TableCell className="tabular-nums"><Link className="underline" href={`${ROTA_FILIAL}/${k.id}`}>{k.nota_fiscal}</Link></TableCell>
                <TableCell>
                  {k.cliente_nome}
                  {k.obra && <span className="text-muted-foreground"> · {k.obra}</span>}
                  {!k.aceita_boleto_factoring && <Badge variant="outline" className="ml-2" title="Cliente não aceita boleto de factoring">Sem boleto de factoring</Badge>}
                </TableCell>
                <TableCell><Badge variant={COR_ESTAGIO[e]}>{ROTULO_ESTAGIO_KIT[e]}</Badge>{k.cedido && <Badge variant="outline" className="ml-1">AKF</Badge>}</TableCell>
                <TableCell className="text-[13px] text-muted-foreground">{faltas.join(", ")}</TableCell>
                <TableCell className="text-right tabular-nums">{k.valor_total != null ? formatarMoeda(emCentavos(k.valor_total)) : "—"}</TableCell>
                <TableCell>{formatarData(k.primeiro_vencimento)}</TableCell>
                <TableCell>{new Date(k.criado_em as string).toLocaleDateString("pt-BR", { timeZone: "America/Cuiaba" })}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
