import type { Metadata } from "next";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { competencia, reais } from "@/lib/modulos/fiscal/creditos/formatos";
import { pode, ROTA_CREDITOS, ROTULO_DISPONIBILIDADE, ROTULO_VALIDACAO, type Disponibilidade, type Validacao } from "@/lib/modulos/fiscal/creditos/modulo";
import { sanitizarBusca } from "@/lib/nucleo/erros";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { Paginacao, Secao, Selo, tomDisponibilidade, tomValidacao, Vazio } from "../componentes";
import { comFiltros, contexto, lerCadastros, lerFiltros, nomes } from "../dados";
import { BarraFiltros } from "../filtros";
import { FormNovoCredito } from "../formularios";

export const metadata: Metadata = { title: "Créditos tributários" };
const POR_PAGINA = 25;
const link = "inline-flex h-7 items-center rounded-[3px] border bg-botao-claro px-2.5 font-condensada text-[12px] font-bold hover:bg-grade-clara";

export default async function PaginaListaCreditos({ searchParams }: PageProps<"/fiscal/creditos/creditos">) {
  const { supabase, papel } = await contexto();
  const sp = await searchParams;
  const f = lerFiltros(sp, Number(hojeEmCuiaba().slice(0, 4)));
  const disp = typeof sp.disponibilidade === "string" ? sp.disponibilidade : "";
  const arquivados = sp.arquivados === "1";
  const cad = await lerCadastros();
  const n = nomes(cad);
  let q = supabase.from("fis_creditos_saldos")
    .select("id, codigo, estabelecimento_id, tributo_id, categoria_id, competencia_origem, descricao, numero_processo, valor_original, valor_reconhecido, utilizado, compensado, baixado, saldo, saldo_disponivel, validacao, disponibilidade, pendentes, ficticio", { count: "exact" })
    .eq("arquivado", arquivados).order("competencia_origem", { ascending: false }).order("codigo", { ascending: false })
    .range((f.pagina - 1) * POR_PAGINA, f.pagina * POR_PAGINA - 1);
  if (f.empresa) q = q.eq("empresa_id", f.empresa);
  if (f.estab) q = q.eq("estabelecimento_id", f.estab);
  if (f.tributo) q = q.eq("tributo_id", f.tributo);
  if (f.validacao) q = q.eq("validacao", f.validacao);
  if (disp && disp in ROTULO_DISPONIBILIDADE) q = q.eq("disponibilidade", disp);
  const busca = sanitizarBusca(f.busca);
  if (busca) q = q.or(`codigo.ilike.%${busca}%,descricao.ilike.%${busca}%,numero_processo.ilike.%${busca}%`);
  const { data, count, error } = await q;
  if (error) throw new Error(`Créditos: ${error.message}`);
  const base = { empresa: f.empresa, estab: f.estab, tributo: f.tributo, validacao: f.validacao, busca: f.busca };
  const qs = new URLSearchParams(Object.entries({ ...base, disponibilidade: disp }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <Secao titulo="Créditos tributários" descricao="Registrado ≠ validado ≠ disponível: só créditos validados, sem bloqueio e no prazo cadastrado ficam disponíveis."
      acoes={<>
        {pode(papel, "lancar") && <FormNovoCredito cad={cad} />}
        {pode(papel, "lancar") && <Link className={link} href={`${ROTA_CREDITOS}/importacao?tipo=creditos`}>Importar planilha</Link>}
        <a className={link} href={`${ROTA_CREDITOS}/relatorios/exportar/creditos?${qs}`}>Exportar Excel</a>
      </>}>
      <BarraFiltros cad={cad} f={f} campos={["empresa", "estab", "tributo", "validacao", "busca"]} />
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {Object.entries(ROTULO_DISPONIBILIDADE).filter(([k]) => k !== "arquivado").map(([k, v]) => (
          <Link key={k} href={comFiltros(`${ROTA_CREDITOS}/creditos`, base, { disponibilidade: k === disp ? "" : k })}
            className={`rounded-[3px] border px-2 py-0.5 ${k === disp ? "border-marca bg-marca-clara font-bold" : "hover:bg-muted"}`}>{v}</Link>
        ))}
        <Link href={arquivados ? `${ROTA_CREDITOS}/creditos` : `${ROTA_CREDITOS}/creditos?arquivados=1`} className="rounded-[3px] border px-2 py-0.5 hover:bg-muted">
          {arquivados ? "Ver ativos" : "Ver arquivados"}
        </Link>
      </div>
      {(data ?? []).length === 0 ? (
        <div className="mt-3"><Vazio titulo="Nenhum crédito encontrado">Ajuste os filtros ou cadastre o primeiro crédito (botão “Novo crédito”) — ele nasce pendente de validação.</Vazio></div>
      ) : (
        <div className="mt-3">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Código</TableHead><TableHead>Estabelecimento</TableHead><TableHead>Tributo</TableHead><TableHead>Categoria</TableHead>
              <TableHead>Origem (comp.)</TableHead><TableHead className="text-right">Original</TableHead><TableHead className="text-right">Reconhecido</TableHead>
              <TableHead className="text-right">Utilizado/compensado</TableHead><TableHead className="text-right">Baixado</TableHead><TableHead className="text-right">Saldo</TableHead>
              <TableHead className="text-right">Disponível</TableHead><TableHead>Validação</TableHead><TableHead>Disponibilidade</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(data ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell><Link className="font-medium text-elo hover:underline" href={`${ROTA_CREDITOS}/creditos/${c.id}`}>{c.codigo}</Link>{c.ficticio && <span className="ml-1 text-[10px] text-muted-foreground">(fictício)</span>}</TableCell>
                  <TableCell>{n.estab.get(c.estabelecimento_id)}</TableCell>
                  <TableCell>{n.tributo.get(c.tributo_id)}</TableCell>
                  <TableCell className="max-w-56 truncate" title={c.descricao}>{n.categoria.get(c.categoria_id)}</TableCell>
                  <TableCell>{competencia(c.competencia_origem)}</TableCell>
                  <TableCell className="text-right tabular-nums">{reais(c.valor_original)}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.valor_reconhecido === null ? "—" : reais(c.valor_reconhecido)}</TableCell>
                  <TableCell className="text-right tabular-nums">{reais(Number(c.utilizado) + Number(c.compensado))}</TableCell>
                  <TableCell className="text-right tabular-nums">{reais(c.baixado)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{reais(c.saldo)}</TableCell>
                  <TableCell className="text-right tabular-nums">{reais(c.saldo_disponivel)}</TableCell>
                  <TableCell><Selo tom={tomValidacao(c.validacao)}>{ROTULO_VALIDACAO[c.validacao as Validacao]}</Selo></TableCell>
                  <TableCell><Selo tom={tomDisponibilidade(c.disponibilidade)}>{ROTULO_DISPONIBILIDADE[c.disponibilidade as Disponibilidade]}</Selo>{c.pendentes > 0 && <span className="ml-1 text-[11px] text-amber-700">{c.pendentes} pend.</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Paginacao pagina={f.pagina} total={count ?? 0} porPagina={POR_PAGINA}
            href={(p) => comFiltros(`${ROTA_CREDITOS}/creditos`, { ...base, disponibilidade: disp, arquivados: arquivados ? "1" : "" }, { pagina: p })} />
        </div>
      )}
    </Secao>
  );
}
