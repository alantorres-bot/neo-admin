import type { Metadata } from "next";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { competencia, data, MESES } from "@/lib/modulos/fiscal/creditos/formatos";
import { pode, ROTA_CREDITOS, ROTULO_STATUS_OBRIGACAO, STATUS_OBRIGACAO_FINAIS, type StatusObrigacao } from "@/lib/modulos/fiscal/creditos/modulo";
import { sanitizarBusca } from "@/lib/nucleo/erros";
import { diferencaDias, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { Indicador, Secao, Selo, tomObrigacao, Vazio } from "../componentes";
import { comFiltros, contexto, lerCadastros, lerFiltros, nomes } from "../dados";
import { BarraFiltros } from "../filtros";
import { FormGerar, FormObrigacao } from "./formulario";

export const metadata: Metadata = { title: "Obrigações fiscais" };
const link = "inline-flex h-7 items-center rounded-[3px] border bg-botao-claro px-2.5 font-condensada text-[12px] font-bold hover:bg-grade-clara";

type Obrigacao = {
  id: string; tipo_id: string; estabelecimento_id: string; competencia: string; vencimento: string | null; vencimento_confirmado: boolean; status: StatusObrigacao;
  responsavel_id: string | null; contador_responsavel: string | null; numero_recibo: string | null; data_transmissao: string | null; retificadora_de: string | null; ficticio: boolean;
};

export default async function PaginaObrigacoes({ searchParams }: PageProps<"/fiscal/creditos/obrigacoes">) {
  const { supabase, papel } = await contexto();
  const sp = await searchParams;
  const hoje = hojeEmCuiaba();
  const f = lerFiltros(sp, Number(hoje.slice(0, 4)));
  const vista = sp.vista === "calendario" ? "calendario" : "lista";
  const cad = await lerCadastros();
  const n = nomes(cad);
  const mesCal = f.mes ?? (f.ano === Number(hoje.slice(0, 4)) ? Number(hoje.slice(5, 7)) : 1);
  let q = supabase.from("fis_obrigacoes").select("id, tipo_id, estabelecimento_id, competencia, vencimento, vencimento_confirmado, status, responsavel_id, contador_responsavel, numero_recibo, data_transmissao, retificadora_de, ficticio")
    .order("vencimento", { ascending: true, nullsFirst: true }).order("competencia").limit(1000);
  if (vista === "calendario") {
    const ini = `${f.ano}-${String(mesCal).padStart(2, "0")}-01`;
    const fim = new Date(Date.UTC(f.ano, mesCal, 0)).toISOString().slice(0, 10);
    const anterior = mesCal === 1 ? `${f.ano - 1}-12-01` : `${f.ano}-${String(mesCal - 1).padStart(2, "0")}-01`;
    // vencem no mês, ou são da competência anterior e ainda não têm vencimento cadastrado
    q = q.or(`and(vencimento.gte.${ini},vencimento.lte.${fim}),and(vencimento.is.null,competencia.eq.${anterior})`);
  } else {
    q = q.gte("competencia", `${f.ano}-01-01`).lte("competencia", `${f.ano}-12-01`);
    if (f.mes) q = q.eq("competencia", `${f.ano}-${String(f.mes).padStart(2, "0")}-01`);
  }
  if (f.empresa) q = q.eq("empresa_id", f.empresa);
  if (f.estab) q = q.eq("estabelecimento_id", f.estab);
  if (f.tributo) q = q.eq("tributo_id", f.tributo);
  if (f.status) q = q.eq("status", f.status);
  const busca = sanitizarBusca(f.busca);
  if (busca) q = q.or(`numero_recibo.ilike.%${busca}%,contador_responsavel.ilike.%${busca}%,observacoes.ilike.%${busca}%`);
  const { data: linhas, error } = await q;
  if (error) throw new Error(`Obrigações: ${error.message}`);
  const lista = (linhas ?? []) as Obrigacao[];
  const aberta = (o: Obrigacao) => !STATUS_OBRIGACAO_FINAIS.includes(o.status);
  const atrasada = (o: Obrigacao) => aberta(o) && !!o.vencimento && o.vencimento < hoje;
  const proxima = (o: Obrigacao) => aberta(o) && !!o.vencimento && o.vencimento >= hoje && diferencaDias(o.vencimento, hoje) <= 7;
  const base = { empresa: f.empresa, estab: f.estab, tributo: f.tributo, ano: f.ano, mes: f.mes, status: f.status, busca: f.busca };
  const qs = new URLSearchParams(Object.entries(base).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString();

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Indicador rotulo="Pendentes" valor={lista.filter(aberta).length} tom="atencao" />
        <Indicador rotulo="Atrasadas" valor={lista.filter(atrasada).length} tom={lista.some(atrasada) ? "grave" : "bom"} />
        <Indicador rotulo="Vencem em até 7 dias" valor={lista.filter(proxima).length} tom={lista.some(proxima) ? "atencao" : "neutro"} />
        <Indicador rotulo="Transmitidas a conferir" valor={lista.filter((o) => o.status === "transmitida").length} tom="info" />
        <Indicador rotulo="Vencimento a confirmar" valor={lista.filter((o) => aberta(o) && !o.vencimento_confirmado).length} tom="atencao" detalhe="Sem regra validada" />
      </div>
      <Secao titulo="Central de obrigações" descricao="Arquivo salvo NÃO é declaração entregue: 'Transmitida' exige data, número do recibo/protocolo e o recibo anexado; a conferência é feita por outra pessoa."
        acoes={<>
          {pode(papel, "lancar") && <FormObrigacao cad={cad} />}
          {pode(papel, "lancar") && <FormGerar cad={cad} />}
          <Link className={link} href={comFiltros(`${ROTA_CREDITOS}/obrigacoes`, base, { vista: vista === "lista" ? "calendario" : "" })}>{vista === "lista" ? "Ver calendário" : "Ver lista"}</Link>
          <a className={link} href={`${ROTA_CREDITOS}/relatorios/exportar/obrigacoes?${qs}`}>Exportar Excel</a>
        </>}>
        <BarraFiltros cad={cad} f={f} campos={["ano", "mes", "empresa", "estab", "tributo", "status", "busca"]} />
        {vista === "calendario" ? (
          <Calendario ano={f.ano} mes={mesCal} hoje={hoje} lista={lista} rotulo={(o) => `${n.tipoObr.get(o.tipo_id)} · ${n.estab.get(o.estabelecimento_id)}`} atrasada={atrasada} />
        ) : lista.length === 0 ? (
          <div className="mt-3"><Vazio titulo="Nenhuma obrigação">Marque em Configurações quais obrigações se aplicam a cada estabelecimento e use “Gerar pelo perfil tributário”, ou cadastre uma a uma.</Vazio></div>
        ) : (
          <div className="mt-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Obrigação</TableHead><TableHead>Estabelecimento</TableHead><TableHead>Competência</TableHead><TableHead>Vencimento</TableHead>
                <TableHead>Situação</TableHead><TableHead>Responsável</TableHead><TableHead>Contador</TableHead><TableHead>Transmissão</TableHead><TableHead>Recibo</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {lista.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell><Link className="text-elo hover:underline" href={`${ROTA_CREDITOS}/obrigacoes/${o.id}`}>{n.tipoObr.get(o.tipo_id)}</Link>{o.retificadora_de && <Selo className="ml-1">retificadora</Selo>}{o.ficticio && <span className="ml-1 text-[10px] text-muted-foreground">(fictício)</span>}</TableCell>
                    <TableCell>{n.estab.get(o.estabelecimento_id)}</TableCell>
                    <TableCell>{competencia(o.competencia)}</TableCell>
                    <TableCell>{o.vencimento ? data(o.vencimento) : "—"}{!o.vencimento_confirmado && aberta(o) && <Selo tom="atencao" className="ml-1">a confirmar</Selo>}</TableCell>
                    <TableCell><Selo tom={tomObrigacao(o.status, atrasada(o))}>{ROTULO_STATUS_OBRIGACAO[o.status]}{atrasada(o) ? " · atrasada" : ""}</Selo></TableCell>
                    <TableCell>{o.responsavel_id ? n.usuario.get(o.responsavel_id) : "—"}</TableCell>
                    <TableCell>{o.contador_responsavel ?? "—"}</TableCell>
                    <TableCell>{data(o.data_transmissao) || "—"}</TableCell>
                    <TableCell>{o.numero_recibo ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Secao>
    </div>
  );
}

function Calendario({ ano, mes, hoje, lista, rotulo, atrasada }: { ano: number; mes: number; hoje: string; lista: Obrigacao[]; rotulo: (o: Obrigacao) => string; atrasada: (o: Obrigacao) => boolean }) {
  const primeiro = new Date(Date.UTC(ano, mes - 1, 1));
  const dias = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const vazio = primeiro.getUTCDay();
  const semVenc = lista.filter((o) => !o.vencimento);
  const celulas = [...Array(vazio).fill(null), ...Array.from({ length: dias }, (_, i) => i + 1)];
  return (
    <div className="mt-3 space-y-2">
      <h3 className="font-condensada font-bold">{MESES[mes - 1]} de {ano}</h3>
      <div className="grid grid-cols-7 gap-1 text-xs">
        {["dom", "seg", "ter", "qua", "qui", "sex", "sáb"].map((d) => <div key={d} className="px-1 font-bold text-muted-foreground">{d}</div>)}
        {celulas.map((d, i) => {
          const iso = d ? `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "";
          const doDia = d ? lista.filter((o) => o.vencimento === iso) : [];
          return (
            <div key={i} className={`min-h-20 rounded-[3px] border p-1 ${!d ? "border-transparent" : iso === hoje ? "border-marca" : ""}`}>
              {d && <div className="text-[11px] text-muted-foreground">{d}</div>}
              {doDia.map((o) => (
                <Link key={o.id} href={`${ROTA_CREDITOS}/obrigacoes/${o.id}`} title={`${rotulo(o)} — ${ROTULO_STATUS_OBRIGACAO[o.status]}`} className="mt-0.5 block">
                  <Selo tom={tomObrigacao(o.status, atrasada(o))} className="max-w-full truncate">{rotulo(o)}</Selo>
                </Link>
              ))}
            </div>
          );
        })}
      </div>
      {semVenc.length > 0 && (
        <p className="text-xs"><strong>Vencimento não cadastrado (a confirmar):</strong> {semVenc.map((o) => <Link key={o.id} className="mr-2 text-elo hover:underline" href={`${ROTA_CREDITOS}/obrigacoes/${o.id}`}>{rotulo(o)} {competencia(o.competencia)}</Link>)}</p>
      )}
    </div>
  );
}
