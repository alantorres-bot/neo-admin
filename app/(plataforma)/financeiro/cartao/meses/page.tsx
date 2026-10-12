import type { Metadata } from "next";
import Link from "next/link";
import { CLASSE_SITUACAO, competenciasAte, ROTULO_SITUACAO, rotuloCompetencia, somarMeses, type SituacaoCiclo } from "@/lib/modulos/financeiro/cartao/ciclos";
import { ROTA_CARTAO } from "@/lib/modulos/financeiro/cartao/modulo";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { gerarCiclos, lerCartoes, listarCiclos, type CicloLinha } from "../dados";

export const metadata: Metadata = { title: "Cartão de crédito · Meses" };

const MESES_NA_GRADE = 6;
const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const centavos = (v: number | string | null) => (v === null ? null : Math.round(Number(v) * 100));

/**
 * Grade cartão × mês: a situação de cada fechamento (aguardando fatura, em conciliação, fechada, paga). A página chama a
 * geração dos ciclos (idempotente; a mesma função roda todo dia às 07:00) para nunca mostrar um mês que já fechou sem linha.
 */
export default async function PaginaMeses({ searchParams }: PageProps<"/financeiro/cartao/meses">) {
  await exigirSessao();
  const parametros = await searchParams;
  const hoje = hojeEmCuiaba();
  const ateParam = primeiro(parametros.ate);
  const ate = /^\d{4}-\d{2}$/.test(ateParam) ? `${ateParam}-01` : `${hoje.slice(0, 7)}-01`;
  const competencias = competenciasAte(ate, MESES_NA_GRADE);
  const ultima = competencias[competencias.length - 1];
  const mesAtual = `${hoje.slice(0, 7)}-01`;
  const anterior = somarMeses(ultima, -MESES_NA_GRADE).slice(0, 7);
  const seguinte = (somarMeses(ultima, MESES_NA_GRADE) > mesAtual ? mesAtual : somarMeses(ultima, MESES_NA_GRADE)).slice(0, 7);

  const supabase = await criarClienteServidor();
  const erroGerar = await gerarCiclos(supabase);
  const [cartoes, ciclos] = await Promise.all([
    lerCartoes(supabase),
    listarCiclos(supabase, { de: competencias[0], ate: competencias[competencias.length - 1] }),
  ]);
  const porChave = new Map<string, CicloLinha>(ciclos.map((c) => [`${c.cartao}|${c.competencia}`, c]));
  const ativos = cartoes.filter((c) => c.ativo || ciclos.some((x) => x.cartao === c.codigo));

  const contagem = (s: SituacaoCiclo) => ciclos.filter((c) => c.situacao === s).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Um mês por cartão (pelo vencimento). Cada mês nasce “Aguardando fatura” no dia seguinte ao fechamento do cartão, passa a “Em conciliação” com a fatura importada, é fechado pelo gestor quando não há nada a lançar e a diferença é zero, e vira “Paga” sozinho quando o título provisório sai do Consistem.
        </p>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`${ROTA_CARTAO}/meses?ate=${anterior}`} className="text-elo hover:underline">‹ anteriores</Link>
          <span className="text-muted-foreground">{rotuloCompetencia(competencias[0])} a {rotuloCompetencia(competencias[competencias.length - 1])}</span>
          {ultima < mesAtual && <Link href={`${ROTA_CARTAO}/meses?ate=${seguinte}`} className="text-elo hover:underline">seguintes ›</Link>}
        </div>
      </div>
      {erroGerar && <p role="alert" className="rounded-[3px] border border-amber-300 bg-amber-50 p-2 text-sm">Não foi possível criar os meses novos agora ({erroGerar}). A grade mostra o que já existe.</p>}

      <div className="flex flex-wrap gap-2 text-xs">
        {(["aguardando_fatura", "em_conciliacao", "fechada", "paga"] as const).map((s) => (
          <span key={s} className={`rounded-[3px] border px-2 py-0.5 ${CLASSE_SITUACAO[s]}`}>{ROTULO_SITUACAO[s]}: {contagem(s)}</span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-cabecalho">
              <th className="border border-grade px-2 py-1.5 text-left">Cartão</th>
              {competencias.map((c) => <th key={c} className="border border-grade px-2 py-1.5 text-center tabular-nums">{rotuloCompetencia(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {ativos.map((k) => (
              <tr key={k.codigo}>
                <th className="border border-grade px-2 py-1.5 text-left font-medium">
                  <Link href={`${ROTA_CARTAO}/historico?cartao=${encodeURIComponent(k.codigo)}`} className="hover:underline">{k.nome}</Link>
                  <span className="block text-[11px] font-normal text-muted-foreground">fecha {k.dia_fechamento} · vence {k.dia_vencimento}</span>
                </th>
                {competencias.map((comp) => {
                  const c = porChave.get(`${k.codigo}|${comp}`);
                  if (!c) return <td key={comp} className="border border-grade px-2 py-1.5 text-center text-[11px] text-muted-foreground">—</td>;
                  return (
                    <td key={comp} className="border border-grade p-1">
                      <Link href={`${ROTA_CARTAO}/ciclo/${c.id}`} className={`block rounded-[3px] border px-2 py-1 hover:opacity-80 ${CLASSE_SITUACAO[c.situacao]}`}>
                        <span className="block font-bold">{ROTULO_SITUACAO[c.situacao]}</span>
                        <span className="block text-[11px]"><Detalhe c={c} /></span>
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Detalhe({ c }: { c: CicloLinha }) {
  const total = centavos(c.total_fatura);
  switch (c.situacao) {
    case "aguardando_fatura":
      return <>vence {formatarData(c.vencimento_nominal)}</>;
    case "em_conciliacao":
      return c.apurado_em
        ? <>{c.itens_a_lancar ?? 0} a lançar · {formatarMoeda(centavos(c.residuo) ?? 0)}</>
        : <>{total !== null ? formatarMoeda(total) : "fatura importada"} · conferir</>;
    case "fechada":
      return <>{total !== null ? formatarMoeda(total) : ""} · aguardando pagamento</>;
    case "paga":
      return <>{total !== null ? `${formatarMoeda(total)} · ` : ""}paga {formatarData(c.paga_em)}</>;
  }
}
