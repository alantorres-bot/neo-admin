import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CHAVE_DESTINATARIOS, COR_ESTAGIO_KIT, MODULO_FILIAL, pendenciasDoKit, ROTA_FILIAL, ROTULO_ESTAGIO_KIT, type EstagioKit,
} from "@/lib/modulos/financeiro/filial/arquivos";
import { lerConfigImplantacao, montarFichaImplantacao } from "@/lib/modulos/financeiro/filial/implantacao";
import { divergencias, lerParcelasInformadas, type ParcelaConsistem } from "@/lib/modulos/financeiro/filial/remessa";
import { emCentavos } from "@/lib/modulos/financeiro/recebiveis/carteira";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { BotaoAvisoCuiaba } from "../../aviso";
import { BotaoBaixarTudo } from "./baixar";
import { RelatorioImplantacao, type BlocoImplantacao } from "./implantacao";

export const metadata: Metadata = { title: "Remessa da filial" };

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const dataCuiaba = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Cuiaba" }); // aaaa-mm-dd

export default async function PaginaRemessa({ params }: PageProps<"/financeiro/filial/remessas/[numero]">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_FILIAL);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");

  const { numero } = await params;
  if (!/^\d{1,9}$/.test(numero)) notFound();
  const supabase = await criarClienteServidor();
  const { data: r } = await supabase.from("rec_vw_remessas").select("*").eq("numero", Number(numero)).maybeSingle();
  if (!r) notFound();

  const { data: ligacoes } = await supabase.from("rec_remessa_kits").select("kit_id").eq("remessa_id", r.id);
  const idsKits = (ligacoes ?? []).map((l) => l.kit_id as string);
  const [{ data: kits }, { data: informadas }, { data: kitTitulos }, { data: config }, { data: configImplantacao }] = await Promise.all([
    supabase.from("rec_vw_kits").select("id, nota_fiscal, cliente_nome, estagio, aceita_boleto_factoring, parcelas, boletos, notas, demonstrativos, comodatos, cartas, exige_carta")
      .in("id", idsKits.length ? idsKits : ["00000000-0000-0000-0000-000000000000"]).order("nota_fiscal"),
    supabase.from("rec_kits").select("id, parcelas_informadas, data_emissao, cliente_documento, cliente_codigo_erp, cliente_conferido_em").in("id", idsKits.length ? idsKits : ["00000000-0000-0000-0000-000000000000"]),
    supabase.from("rec_kit_titulos").select("kit_id, rec_titulos(documento, vencimento, valor, estagio, contrapartes(codigo_erp))").in("kit_id", idsKits.length ? idsKits : ["00000000-0000-0000-0000-000000000000"]),
    supabase.from("configuracoes").select("valor").eq("chave", CHAVE_DESTINATARIOS).maybeSingle(),
    supabase.from("configuracoes").select("valor").eq("chave", "financeiro.filial.implantacao").maybeSingle(),
  ]);
  const dadosKit = new Map((informadas ?? []).map((k) => [k.id as string, k]));
  const codigoDoTitulo = new Map<string, string>();
  const parcelasPorKit = new Map((informadas ?? []).map((k) => [k.id as string, lerParcelasInformadas(k.parcelas_informadas)]));
  const titulosPorKit = new Map<string, ParcelaConsistem[]>();
  for (const l of kitTitulos ?? []) {
    const t = (Array.isArray(l.rec_titulos) ? l.rec_titulos[0] : l.rec_titulos) as {
      documento: string; vencimento: string; valor: number | string; estagio: string; contrapartes: { codigo_erp: string | null } | { codigo_erp: string | null }[] | null;
    } | null;
    if (!t || t.estagio === "cancelado" || t.estagio === "renegociado") continue;
    const cp = Array.isArray(t.contrapartes) ? t.contrapartes[0] : t.contrapartes;
    if (cp?.codigo_erp) codigoDoTitulo.set(l.kit_id as string, cp.codigo_erp);
    const lista = titulosPorKit.get(l.kit_id as string) ?? [];
    lista.push({ documento: t.documento, vencimento: t.vencimento, valorCentavos: emCentavos(t.valor) });
    titulosPorKit.set(l.kit_id as string, lista);
  }
  const para = Array.isArray(config?.valor) ? (config.valor as unknown[]).filter((t): t is string => typeof t === "string") : [];
  const cfgImplantacao = lerConfigImplantacao(configImplantacao?.valor);
  const blocos: BlocoImplantacao[] = (kits ?? []).filter((k) => k.estagio !== "cancelada").map((k) => {
    const d = dadosKit.get(k.id);
    const parcelas = parcelasPorKit.get(k.id) ?? [];
    const titulos = titulosPorKit.get(k.id) ?? [];
    return {
      kitId: k.id, nota: k.nota_fiscal, cliente: k.cliente_nome, semBoletoFactoring: !k.aceita_boleto_factoring,
      titulos: titulos.map((t) => t.documento), divergencias: divergencias(parcelas, titulos),
      ficha: montarFichaImplantacao({
        nota: k.nota_fiscal, emissao: (d?.data_emissao as string | null) ?? null, clienteNome: k.cliente_nome,
        clienteDocumento: (d?.cliente_documento as string | null) ?? null,
        clienteCodigoErp: (d?.cliente_codigo_erp as string | null) ?? codigoDoTitulo.get(k.id) ?? null,
        clienteConferido: !!d?.cliente_conferido_em || codigoDoTitulo.has(k.id), parcelas,
      }, cfgImplantacao),
    };
  });
  const itensAviso = (kits ?? []).filter((k) => k.estagio !== "cancelada").map((k) => ({
    nota: k.nota_fiscal as string, cliente: k.cliente_nome as string, aceitaBoletoFactoring: !!k.aceita_boleto_factoring, parcelas: parcelasPorKit.get(k.id) ?? [],
  }));

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" render={<Link href={`${ROTA_FILIAL}/remessas`} />}><ArrowLeft /> Remessas</Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Remessa nº {r.numero} da filial</h1>
          <p className="text-sm text-muted-foreground">
            Enviada por {r.criado_por_nome ?? "—"} em {quando(r.criado_em)} · {r.kits} {r.kits === 1 ? "NF" : "NFs"}
            {r.aviso_aberto_em ? <> · aviso a Cuiabá aberto em {quando(r.aviso_aberto_em)}</> : <> · aviso a Cuiabá ainda não aberto</>}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <BotaoBaixarTudo remessaId={r.id} />
          {podeOperar && itensAviso.length > 0 && (
            <BotaoAvisoCuiaba remessaId={r.id} numero={r.numero} data={dataCuiaba(r.criado_em)} itens={itensAviso} para={para} variante={r.aviso_aberto_em ? "outline" : "default"} />
          )}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow><TableHead>NF</TableHead><TableHead>Cliente</TableHead><TableHead>Vencimento e valor (nota)</TableHead><TableHead>Estágio</TableHead><TableHead>Conferência com o Consistem</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {(kits ?? []).map((k) => {
            const e = k.estagio as EstagioKit;
            const parcelas = parcelasPorKit.get(k.id) ?? [];
            const titulos = titulosPorKit.get(k.id) ?? [];
            const div = divergencias(parcelas, titulos);
            const faltas = pendenciasDoKit({
              estagio: e, notas: k.notas, demonstrativos: k.demonstrativos, comodatos: k.comodatos, cartas: k.cartas,
              parcelas: k.parcelas ?? 0, boletos: k.boletos ?? 0, exigeCarta: !!k.exige_carta,
            });
            return (
              <TableRow key={k.id}>
                <TableCell className="tabular-nums"><Link className="underline" href={`${ROTA_FILIAL}/${k.id}`}>{k.nota_fiscal}</Link></TableCell>
                <TableCell>
                  {k.cliente_nome}
                  {!k.aceita_boleto_factoring && <Badge variant="outline" className="ml-2">Sem boleto de factoring</Badge>}
                </TableCell>
                <TableCell className="text-[13px] tabular-nums">
                  {parcelas.length === 0 ? <span className="text-muted-foreground">não informado</span>
                    : parcelas.map((p) => <div key={p.vencimento}>{formatarData(p.vencimento)} · {formatarMoeda(p.valorCentavos)}</div>)}
                </TableCell>
                <TableCell>
                  <Badge variant={COR_ESTAGIO_KIT[e]}>{ROTULO_ESTAGIO_KIT[e]}</Badge>
                  {faltas.length > 0 && <div className="text-[13px] text-muted-foreground">falta {faltas.join(", ")}</div>}
                </TableCell>
                <TableCell className="text-[13px]">
                  {titulos.length === 0 ? <span className="text-muted-foreground">aguardando implantação</span>
                    : div.length === 0 ? (parcelas.length === 0 ? <span className="text-muted-foreground">sem dado da nota para comparar</span> : "confere")
                      : div.map((d) => <div key={d} className="text-destructive">{d}</div>)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {blocos.length > 0 && <RelatorioImplantacao blocos={blocos} rotina={cfgImplantacao.rotina} podeOperar={podeOperar} />}
    </div>
  );
}
