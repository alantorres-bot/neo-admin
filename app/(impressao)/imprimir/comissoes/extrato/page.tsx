import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/app/(impressao)/imprimir/contas-pagar/autorizacao/[id]/botao-imprimir";
import { rotuloCompetencia } from "@/app/(plataforma)/comercial/comissoes/dados";
import { MODULO_COMISSOES } from "@/lib/modulos/comercial/comissoes/regras";
import { resumirAno, type FechamentoResumo } from "@/lib/modulos/comercial/comissoes/resumo";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Extrato de comissões" };

const situacao = (f: FechamentoResumo) => (f.historico ? "Pago (planilha)" : f.status === "fechado" ? `Fechado em ${formatarData(f.fechado_em)}` : "Em conferência");

/**
 * Extrato do ano de UM representante (?rep=<código>&ano=<aaaa>): mês a mês, comissão, antecipações e saldo, com os
 * totais do ano. Mesma folha do relatório mensal (logo, assinaturas).
 */
export default async function PaginaExtratoComissoes({ searchParams }: PageProps<"/imprimir/comissoes/extrato">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_COMISSOES);
  if (!modulo || !modulo.ativo || !temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_COMISSOES)) notFound();
  const p = await searchParams;
  const cod = typeof p.rep === "string" ? p.rep : "";
  const ano = Number(p.ano);
  if (!cod || !Number.isInteger(ano) || ano < 2020 || ano > 2100) notFound();
  const supabase = await criarClienteServidor();
  const [{ data: rep }, { data: fechamentos }, { data: linhas }] = await Promise.all([
    supabase.from("fin_com_representantes").select("cod_representante, nome, perc_venda, perc_locacao").eq("cod_representante", cod).maybeSingle(),
    supabase.from("fin_com_fechamentos").select("id, competencia, status, historico, fechado_em").gte("competencia", `${ano}-01-01`).lte("competencia", `${ano}-12-01`),
    supabase.from("fin_com_linhas").select("fechamento_id, cod_representante, origem, incluida, valor_comissao").eq("cod_representante", cod).range(0, 9_999),
  ]);
  if (!rep) notFound();
  const resumo = resumirAno((fechamentos ?? []) as FechamentoResumo[], linhas ?? [], ano);
  const meses = [...resumo.meses].reverse().filter((m) => m.porRepresentante[cod]); // do mais antigo para o mais recente
  const total = resumo.porRepresentante[cod] ?? { total: 0, antecipado: 0, saldo: 0 };
  const emConferencia = meses.some((m) => m.fechamento.status === "em_conferencia");

  return (
    <>
      <title>{`Extrato de comissões ${rep.nome} - ${ano}`}</title>
      <BotaoImprimir />
      <article className="relatorio flex flex-col gap-4 text-[12px] leading-snug text-zinc-900">
        <header className="flex items-start justify-between gap-6 border-b-2 border-zinc-900 pb-3">
          <div className="flex flex-col gap-1.5">
            {/* Proporção do arquivo (1792×291): largura fixa e altura automática; self-start para a coluna não esticar a imagem. */}
            <Image src="/neo-formas-logo-horizontal.png" alt="Neo Formas para concreto" width={1792} height={291}
              className="mb-2 self-start" style={{ width: 240, height: "auto" }} priority unoptimized />
            <h1 className="text-[22px] font-bold tracking-tight">Extrato de comissões — {ano}</h1>
            <p className="text-[13px] text-zinc-700">Mês a mês: comissão, antecipações já pagas e saldo de cada fechamento.</p>
          </div>
          <div className="flex flex-col items-end gap-1 text-right text-[11px] text-zinc-700">
            {emConferencia && <span className="border-2 border-zinc-900 px-2 py-0.5 text-[11px] font-bold tracking-wide text-zinc-900">COM MÊS EM CONFERÊNCIA</span>}
            <span>Financeiro · Comissões</span>
            <span>Emitido em {formatarData(hojeEmCuiaba())}</span>
          </div>
        </header>

        <section className="flex items-end justify-between gap-6">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-zinc-600">Representante</span>
            <strong className="text-[18px]">{rep.nome}</strong>
            <span className="text-[11px] text-zinc-700">Código {rep.cod_representante} no Consistem</span>
          </div>
          <div className="flex gap-2 text-[11px]">
            <span className="rounded border border-zinc-400 px-2 py-1">Venda <strong>{Number(rep.perc_venda).toLocaleString("pt-BR")}%</strong></span>
            <span className="rounded border border-zinc-400 px-2 py-1">Locação <strong>{Number(rep.perc_locacao).toLocaleString("pt-BR")}%</strong></span>
          </div>
        </section>

        <section className="grid grid-cols-3 gap-2.5">
          <div className="flex flex-col gap-0.5 rounded-md border border-zinc-300 px-3 py-2.5">
            <span className="text-[11px] text-zinc-600">Comissão no ano</span>
            <strong className="text-[16px] tabular-nums">{formatarMoeda(total.total)}</strong>
            <span className="text-[11px] text-zinc-600">{meses.length} mês(es) com comissão</span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-md border border-zinc-300 px-3 py-2.5">
            <span className="text-[11px] text-zinc-600">Antecipações descontadas</span>
            <strong className="text-[16px] tabular-nums">{formatarMoeda(total.antecipado)}</strong>
          </div>
          <div className="flex flex-col gap-0.5 rounded-md border-2 border-zinc-900 bg-zinc-100 px-3 py-2.5">
            <span className="text-[11px] font-semibold">Saldo do ano</span>
            <strong className="text-[19px] tabular-nums">{formatarMoeda(total.saldo)}</strong>
            <span className="text-[11px] text-zinc-700">Comissão − antecipações</span>
          </div>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="text-[13px] font-bold">Mês a mês</h2>
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-y border-zinc-900 text-left">
                <th className="py-1.5 pr-2 font-semibold">Mês</th>
                <th className="px-2 py-1.5 font-semibold">Situação</th>
                <th className="px-2 py-1.5 text-right font-semibold">Comissão</th>
                <th className="px-2 py-1.5 text-right font-semibold">Antecipado</th>
                <th className="py-1.5 pl-2 text-right font-semibold">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {meses.map((m) => {
                const t = m.porRepresentante[cod];
                return (
                  <tr key={m.fechamento.id} className="border-b border-zinc-300">
                    <td className="py-1.5 pr-2 font-medium first-letter:uppercase">{rotuloCompetencia(m.fechamento.competencia)}</td>
                    <td className="px-2 py-1.5 text-zinc-700">{situacao(m.fechamento)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatarMoeda(t.total)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{t.antecipado ? `− ${formatarMoeda(t.antecipado)}` : formatarMoeda(0)}</td>
                    <td className="py-1.5 pl-2 text-right font-semibold tabular-nums">{formatarMoeda(t.saldo)}</td>
                  </tr>
                );
              })}
              {meses.length === 0 && <tr><td colSpan={5} className="py-3 text-zinc-600">Nenhuma comissão em {ano}.</td></tr>}
            </tbody>
          </table>
          {/* Totais fora do <tfoot>: na impressão o tfoot se repetiria em cada página. */}
          <div className="flex justify-end gap-6 border-t-2 border-zinc-900 pt-1.5 text-[13px] font-bold">
            <span>TOTAL DO ANO</span>
            <span className="tabular-nums">{formatarMoeda(total.total)}</span>
            <span className="tabular-nums">{total.antecipado ? `− ${formatarMoeda(total.antecipado)}` : formatarMoeda(0)}</span>
            <span className="tabular-nums">{formatarMoeda(total.saldo)}</span>
          </div>
        </section>

        <section className="flex flex-col gap-1 rounded bg-zinc-100 px-3 py-2 text-[11px] text-zinc-700">
          <strong className="text-zinc-900">De onde vêm os números</strong>
          <span>
            Cada linha é o fechamento do mês (parcelas pagas no mês × percentual). &quot;Pago (planilha)&quot; são os meses pagos antes do sistema,
            importados das planilhas de comissão. O detalhe de cada mês está no relatório de comissão do mês.
          </span>
        </section>

        <section className="mt-6 grid grid-cols-2 gap-10" style={{ breakInside: "avoid" }}>
          <div className="flex flex-col gap-1 pt-8">
            <span className="border-t border-zinc-900 pt-1.5 text-[11px] font-semibold">Conferido por — Financeiro</span>
            <span className="text-[11px] text-zinc-600">Nome e data: ____________________</span>
          </div>
          <div className="flex flex-col gap-1 pt-8">
            <span className="border-t border-zinc-900 pt-1.5 text-[11px] font-semibold">Ciente — {rep.nome}</span>
            <span className="text-[11px] text-zinc-600">Data: ____/____/________</span>
          </div>
        </section>

        <footer className="flex justify-between gap-4 border-t border-zinc-300 pt-2 text-[11px] text-zinc-600">
          <span>Neo Admin · Comissões · extrato de {ano}</span>
          <span>{rep.nome}</span>
        </footer>
      </article>
    </>
  );
}
