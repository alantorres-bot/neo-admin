import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MODULO_FILIAL, ROTA_FILIAL } from "@/lib/modulos/financeiro/filial/arquivos";
import { ehEstagioFila, ROTULO_ESTAGIO_FILA, ROTULO_URGENCIA, textoVencimento, type EstagioFila, type Papel } from "@/lib/modulos/financeiro/filial/estagios";
import { formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { sanitizarBusca } from "@/lib/nucleo/erros";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso, temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { BarraRemessa } from "./barra-remessa";
import { carregarFila, type FiltroVer, type LinhaFila } from "./fila-dados";
import { PainelLateral } from "./painel";
import { COR_URGENCIA, ConteudoKit } from "./painel-conteudo";

export const metadata: Metadata = { title: "Faturamento Filial" };

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const EM_ANDAMENTO: EstagioFila[] = ["falta_demonstrativo", "a_implantar", "aguardando_boleto", "pronta", "nota_enviada", "boleto_a_enviar"];
const UUID = /^[0-9a-f-]{36}$/i;

/** Marcador de documento: ✓ tem, ✗ falta (null = não se aplica). */
function Marca({ rotulo, ok }: { rotulo: string; ok: boolean | null }) {
  if (ok === null) return null;
  return <span className={`whitespace-nowrap ${ok ? "text-foreground" : "font-medium text-destructive"}`}>{rotulo} {ok ? "✓" : "✗"}</span>;
}

/**
 * Fila única do Faturamento Filial: todas as NFs numa tela, com o estágio (o próximo passo), a urgência pelo vencimento, o nº da
 * remessa e a próxima tarefa de quem está vendo. Clicar abre o painel lateral com tudo da NF. A remessa também filtra a fila; o nº
 * dela leva à tela da remessa (Remessas), que é a visão por lote.
 */
export default async function PaginaFilaFilial({ searchParams }: PageProps<"/financeiro/filial">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_FILIAL);
  if (!modulo || !modulo.ativo || !temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_FILIAL)) notFound();
  const podeOperar = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_FILIAL, "operador");
  const ehCuiaba = temAcesso(sessao.acesso, "financeiro");
  const papel: Papel = sessao.acesso.restrito ? "filial" : "cuiaba";

  const p = await searchParams;
  const verPedido = primeiro(p.ver);
  const ver: FiltroVer = ["todas", "enviadas", "criticas"].includes(verPedido) || ehEstagioFila(verPedido) ? (verPedido as FiltroVer) : "minhas";
  const remessa = /^\d{1,9}$/.test(primeiro(p.remessa)) ? Number(primeiro(p.remessa)) : null;
  const busca = sanitizarBusca(primeiro(p.q));
  const nf = UUID.test(primeiro(p.nf)) ? primeiro(p.nf) : null;
  const hoje = hojeEmCuiaba();

  const supabase = await criarClienteServidor();
  const [todas, { data: listaRemessas }] = await Promise.all([
    carregarFila(supabase, { papel, hoje, estagios: ver === "enviadas" ? "enviadas" : "abertas" }),
    supabase.from("rec_vw_remessas").select("numero, kits, aguardando_implantacao").order("numero", { ascending: false }).limit(60),
  ]);

  const digitos = busca.replace(/\D/g, "");
  const daRemessaEBusca = todas.filter((l) =>
    (remessa === null || l.remessas.includes(remessa))
    && (!busca || l.cliente.toLowerCase().includes(busca.toLowerCase()) || (digitos !== "" && l.nota.includes(digitos))));
  const filtrar = (v: FiltroVer, lista: LinhaFila[]) => lista.filter((l) =>
    v === "minhas" ? l.acao.minha : v === "todas" || v === "enviadas" ? true : v === "criticas" ? l.urgencia === "critica" || l.urgencia === "atrasada" : l.situacao.estagio === v);
  const linhas = filtrar(ver, daRemessaEBusca);
  const contagem = (v: FiltroVer) => filtrar(v, ver === "enviadas" ? [] : daRemessaEBusca).length;

  const href = (m: { ver?: FiltroVer; remessa?: number | null; nf?: string | null; q?: string | null }) => {
    const qs = new URLSearchParams();
    const v = m.ver ?? ver;
    if (v !== "minhas") qs.set("ver", v);
    const r = m.remessa === undefined ? remessa : m.remessa;
    if (r) qs.set("remessa", String(r));
    const b = m.q === undefined ? busca : m.q;
    if (b) qs.set("q", b);
    if (m.nf) qs.set("nf", m.nf);
    return qs.size ? `${ROTA_FILIAL}?${qs}` : ROTA_FILIAL;
  };
  const kitAberto = nf ? todas.find((l) => l.id === nf) : null;

  const seletor = (v: FiltroVer, rotulo: string, destaque = false) => {
    const ativo = v === ver;
    const n = v === "enviadas" ? null : contagem(v);
    return (
      <Link key={v} href={href({ ver: v })} aria-current={ativo ? "page" : undefined}
        className={`flex min-w-36 flex-1 items-center justify-between gap-2 px-3 py-1.5 text-[12px] ${ativo ? "border-b-2 border-marca bg-white font-bold" : "bg-cabecalho hover:bg-white"}`}>
        {rotulo}
        {n !== null && <span className={`rounded-[3px] px-1.5 text-[11px] font-bold tabular-nums ring-1 ring-grade ${n > 0 && destaque ? "bg-destructive text-white" : n > 0 ? "bg-marca-clara" : "bg-white text-muted-foreground"}`}>{n}</span>}
      </Link>
    );
  };

  return (
    <div className="space-y-4">
      {/* Filtros: minhas tarefas, críticas, estágios; remessa e busca */}
      <nav aria-label="Filtrar a fila" className="flex flex-wrap gap-px overflow-hidden rounded-[3px] border border-grade bg-grade">
        {seletor("minhas", "Minhas tarefas")}
        {seletor("criticas", "Críticas e atrasadas", true)}
        {EM_ANDAMENTO.map((e) => seletor(e, ROTULO_ESTAGIO_FILA[e]))}
        {seletor("todas", "Todas em andamento")}
        {seletor("enviadas", "Enviadas")}
      </nav>
      <form method="get" className="flex flex-wrap items-center gap-2" role="search">
        {ver !== "minhas" && <input type="hidden" name="ver" value={ver} />}
        <select name="remessa" defaultValue={remessa ?? ""} aria-label="Remessa" className="h-8 rounded-[3px] border border-input bg-white px-2 text-[13px]">
          <option value="">Todas as remessas</option>
          {(listaRemessas ?? []).map((r) => (
            <option key={r.numero} value={r.numero}>Remessa nº {r.numero} · {r.kits} {r.kits === 1 ? "NF" : "NFs"}{r.aguardando_implantacao ? ` · ${r.aguardando_implantacao} a implantar` : ""}</option>
          ))}
        </select>
        <Input name="q" defaultValue={busca} placeholder="Cliente ou nº da NF" aria-label="Buscar" className="w-64" />
        <Button type="submit" variant="secondary">Filtrar</Button>
        {(busca || remessa) && <Button variant="ghost" nativeButton={false} render={<Link href={href({ remessa: null, q: null })} />}>Limpar</Button>}
      </form>

      {remessa && <BarraRemessa numero={remessa} podeOperar={podeOperar} ehCuiaba={ehCuiaba} />}

      {linhas.length === 0 ? (
        <p className="rounded-[3px] border border-dashed p-8 text-center text-sm text-muted-foreground">
          {ver === "minhas" ? "Nenhuma tarefa sua agora. Tudo em dia." : "Nenhuma NF neste filtro."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[3px] border border-grade">
          <Table className="cartoes">
            <TableHeader><TableRow>
              <TableHead>Urgência</TableHead><TableHead>Remessa</TableHead><TableHead>NF</TableHead><TableHead>Cliente</TableHead>
              <TableHead>Estágio</TableHead><TableHead>Documentos</TableHead><TableHead className="text-right">Valor</TableHead><TableHead />
            </TableRow></TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.id} className={l.id === nf ? "bg-marca-clara" : undefined}>
                  <TableCell className="whitespace-nowrap text-[12px]">
                    {l.urgencia && l.urgencia !== "sem_data" ? <Badge variant={COR_URGENCIA[l.urgencia]}>{ROTULO_URGENCIA[l.urgencia]}</Badge> : null}
                    <span className="block text-muted-foreground">{textoVencimento(l.vencimento, hoje)}</span>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {l.remessas.map((n) => <Link key={n} className="mr-1 underline" href={`${ROTA_FILIAL}/remessas/${n}`} title={`Abrir a remessa nº ${n}`}>{n}</Link>)}
                  </TableCell>
                  <TableCell className="font-medium tabular-nums"><Link className="hover:underline" href={href({ nf: l.id })} scroll={false}>{Number(l.nota)}</Link></TableCell>
                  <TableCell className="max-w-64">
                    <span className="block truncate font-medium" title={l.cliente}>{l.cliente}</span>
                    {l.obra && <span className="block truncate text-[12px] text-muted-foreground" title={l.obra}>{l.obra}</span>}
                    <span className="flex flex-wrap gap-1">
                      {l.semBoletoFactoring && <Badge variant="outline">Sem boleto de factoring</Badge>}
                      {l.cedido && <Badge variant="outline">AKF</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="text-[12px]"><Badge variant="secondary">{ROTULO_ESTAGIO_FILA[l.situacao.estagio]}</Badge></TableCell>
                  <TableCell className="space-x-2 text-[12px]">
                    <Marca rotulo="NF" ok={l.docs.nota} /><Marca rotulo="Dem" ok={l.docs.demonstrativo} />
                    <Marca rotulo="Boleto" ok={l.docs.boleto} /><Marca rotulo="Carta" ok={l.docs.carta} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatarMoeda(l.valorCentavos)}</TableCell>
                  <TableCell className="text-right">
                    {l.acao.minha
                      ? <Button size="sm" variant={l.acao.rotulo.startsWith("Cobrar") ? "destructive" : "default"} nativeButton={false} render={<Link href={href({ nf: l.id })} scroll={false} />}>{l.acao.rotulo}</Button>
                      : <Link className="text-[12px] text-muted-foreground hover:underline" href={href({ nf: l.id })} scroll={false}>{l.acao.rotulo}</Link>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="border-t border-grade px-3 py-2 text-sm text-muted-foreground">{linhas.length} {linhas.length === 1 ? "NF" : "NFs"}</div>
        </div>
      )}

      {nf && (
        <PainelLateral
          titulo={kitAberto ? `NF ${Number(kitAberto.nota)} — ${kitAberto.cliente}` : "NF"}
          descricao={kitAberto ? `${ROTULO_ESTAGIO_FILA[kitAberto.situacao.estagio]}${kitAberto.remessas.length ? ` · remessa nº ${kitAberto.remessas.join(", ")}` : ""}` : undefined}
          fecharHref={href({ nf: null })}>
          <ConteudoKit kitId={nf} sessao={sessao} papel={papel} podeOperar={podeOperar} />
        </PainelLateral>
      )}
    </div>
  );
}
