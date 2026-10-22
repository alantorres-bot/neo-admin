import type { Metadata } from "next";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { competencia, data, dataHora, reais } from "@/lib/modulos/fiscal/creditos/formatos";
import { pode, ROTA_CREDITOS, ROTULO_STATUS_MOV } from "@/lib/modulos/fiscal/creditos/modulo";
import { sanitizarBusca } from "@/lib/nucleo/erros";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { AcoesMovimento } from "../blocos";
import { Paginacao, Secao, Selo, Vazio } from "../componentes";
import { comFiltros, contexto, lerCadastros, lerFiltros, nomes } from "../dados";
import { BarraFiltros } from "../filtros";
import { FormMovimento } from "../formularios";

export const metadata: Metadata = { title: "Movimentações" };
const POR_PAGINA = 50;
const link = "inline-flex h-7 items-center rounded-[3px] border bg-botao-claro px-2.5 font-condensada text-[12px] font-bold hover:bg-grade-clara";
const SITUACOES = { efetivo: "Efetivo", pendente: "Pendente de aprovação", rejeitado: "Rejeitado", estornado: "Estornado" };

export default async function PaginaMovimentos({ searchParams }: PageProps<"/fiscal/creditos/movimentos">) {
  const { supabase, papel, sessao } = await contexto();
  const sp = await searchParams;
  const f = lerFiltros(sp, Number(hojeEmCuiaba().slice(0, 4)));
  const tipo = typeof sp.tipo === "string" && /^[a-z0-9_]+$/.test(sp.tipo) ? sp.tipo : "";
  const cad = await lerCadastros();
  const n = nomes(cad);
  let q = supabase.from("fis_movimentos")
    .select("id, numero, credito_id, estabelecimento_id, tributo_id, tipo, classe, valor_assinado, data, competencia, descricao, protocolo, documento_ref, estorno_de, corrige_id, status, estornado, registrado_por, registrado_em, credito:fis_creditos(codigo)", { count: "exact" })
    .gte("competencia", `${f.ano}-01-01`).lte("competencia", `${f.ano}-12-01`)
    .order("competencia", { ascending: false }).order("numero", { ascending: false })
    .range((f.pagina - 1) * POR_PAGINA, f.pagina * POR_PAGINA - 1);
  if (f.mes) q = q.eq("competencia", `${f.ano}-${String(f.mes).padStart(2, "0")}-01`);
  if (f.empresa) q = q.eq("empresa_id", f.empresa);
  if (f.estab) q = q.eq("estabelecimento_id", f.estab);
  if (f.tributo) q = q.eq("tributo_id", f.tributo);
  if (tipo) q = q.eq("tipo", tipo);
  if (f.status === "estornado") q = q.eq("estornado", true);
  else if (f.status) q = q.eq("status", f.status);
  const busca = sanitizarBusca(f.busca);
  if (busca) q = q.or(`descricao.ilike.%${busca}%,protocolo.ilike.%${busca}%`);
  const [{ data: movs, count, error }, { data: creditos }] = await Promise.all([
    q, supabase.from("fis_creditos").select("id, codigo, descricao").eq("arquivado", false).order("codigo").limit(1000),
  ]);
  if (error) throw new Error(`Movimentações: ${error.message}`);
  const base = { empresa: f.empresa, estab: f.estab, tributo: f.tributo, ano: f.ano, mes: f.mes, status: f.status, busca: f.busca, tipo };
  const qs = new URLSearchParams(Object.entries(base).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString();
  const um = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] ?? null : v);

  return (
    <Secao titulo="Livro de movimentações" descricao="Razão imutável de todos os créditos. Nada é apagado: correções por estorno e lançamento corretivo."
      acoes={<>
        {pode(papel, "lancar") && <FormMovimento cad={cad} creditos={creditos ?? []} />}
        {pode(papel, "lancar") && <Link className={link} href={`${ROTA_CREDITOS}/importacao?tipo=movimentos`}>Importar planilha</Link>}
        <a className={link} href={`${ROTA_CREDITOS}/relatorios/exportar/movimentos?${qs}`}>Exportar Excel</a>
      </>}>
      <BarraFiltros cad={cad} f={f} campos={["ano", "mes", "empresa", "estab", "tributo", "status", "busca"]} status={SITUACOES} />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Tipo:</span>
        <Link href={comFiltros(`${ROTA_CREDITOS}/movimentos`, base, { tipo: "" })} className={`rounded-[3px] border px-2 py-0.5 ${!tipo ? "border-marca bg-marca-clara font-bold" : ""}`}>Todos</Link>
        {cad.tiposMovimento.map((t) => (
          <Link key={t.codigo} href={comFiltros(`${ROTA_CREDITOS}/movimentos`, base, { tipo: t.codigo, pagina: 1 })}
            className={`rounded-[3px] border px-2 py-0.5 ${tipo === t.codigo ? "border-marca bg-marca-clara font-bold" : "hover:bg-muted"}`}>{t.nome}</Link>
        ))}
      </div>
      {(movs ?? []).length === 0 ? <div className="mt-3"><Vazio titulo={`Nenhuma movimentação em ${f.mes ? `${String(f.mes).padStart(2, "0")}/` : ""}${f.ano} com estes filtros`}>Movimentações nascem nos créditos (lançamento inicial) e pelo botão “Registrar movimentação”.</Vazio></div> : (
        <div className="mt-3">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Nº</TableHead><TableHead>Crédito</TableHead><TableHead>Estab.</TableHead><TableHead>Tributo</TableHead><TableHead>Competência</TableHead><TableHead>Data</TableHead>
              <TableHead>Tipo</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Descrição</TableHead><TableHead>Protocolo</TableHead><TableHead>Situação</TableHead>
              <TableHead>Registro</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(movs ?? []).map((m) => (
                <TableRow key={m.id} className={m.estornado || m.status === "rejeitado" ? "text-muted-foreground" : ""}>
                  <TableCell>{m.numero}</TableCell>
                  <TableCell><Link className="text-elo hover:underline" href={`${ROTA_CREDITOS}/creditos/${m.credito_id}`}>{um(m.credito as unknown as { codigo: string } | null)?.codigo}</Link></TableCell>
                  <TableCell>{n.estab.get(m.estabelecimento_id)}</TableCell>
                  <TableCell>{n.tributo.get(m.tributo_id)}</TableCell>
                  <TableCell>{competencia(m.competencia)}</TableCell>
                  <TableCell>{data(m.data)}</TableCell>
                  <TableCell>{n.tipoMov.get(m.tipo) ?? m.tipo}{m.corrige_id && <span className="block text-[11px]">lançamento corretivo</span>}</TableCell>
                  <TableCell className={`text-right tabular-nums ${Number(m.valor_assinado) < 0 ? "text-red-700 dark:text-red-400" : ""}`}>{reais(m.valor_assinado)}</TableCell>
                  <TableCell className="max-w-64 truncate" title={m.descricao}>{m.descricao}</TableCell>
                  <TableCell>{m.protocolo ?? (m.tipo === "compensacao" ? <Selo tom="atencao">sem protocolo</Selo> : "—")}</TableCell>
                  <TableCell>{m.estornado ? <Selo>Estornado</Selo> : <Selo tom={m.status === "efetivo" ? "bom" : m.status === "pendente" ? "atencao" : "grave"}>{ROTULO_STATUS_MOV[m.status]}</Selo>}</TableCell>
                  <TableCell className="text-xs">{m.registrado_por ? n.usuario.get(m.registrado_por) : "sistema"}<br />{dataHora(m.registrado_em)}</TableCell>
                  <TableCell><AcoesMovimento m={m} papel={papel} usuarioId={sessao.userId} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Paginacao pagina={f.pagina} total={count ?? 0} porPagina={POR_PAGINA} href={(p) => comFiltros(`${ROTA_CREDITOS}/movimentos`, base, { pagina: p })} />
        </div>
      )}
    </Secao>
  );
}
