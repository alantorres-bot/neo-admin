import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/app/(impressao)/imprimir/contas-pagar/autorizacao/[id]/botao-imprimir";
import { lerItens, lerMes, ROTULO_STATUS, type ItemLinha } from "@/app/(plataforma)/rh/vale_transporte/dados";
import { rotuloMes } from "@/lib/modulos/rh/vale-transporte/calendario";
import { FORMAS_PAGAMENTO, MODULO_VT, ROTULO_FORMA } from "@/lib/modulos/rh/vale-transporte/modulo";
import { formatarData } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Relatório de vale-transporte" };

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const soma = (l: ItemLinha[]) => l.reduce((s, i) => s + Math.round(i.valor * 100), 0) / 100;

/** "RELATÓRIO DE VALE TRANSPORTE - <MÊS>": por empresa, Nº, funcionário, valor total e pagamento; subtotais por empresa e totais por forma de pagamento. */
export default async function PaginaImprimirVt({ params }: PageProps<"/imprimir/rh/vale-transporte/[id]">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_VT);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "rh")) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await criarClienteServidor();
  const [mes, itens] = await Promise.all([lerMes(supabase, id), lerItens(supabase, id)]);
  if (!mes) notFound();
  const empresas = [...new Set(itens.map((i) => i.empregador))].sort();
  const formas = FORMAS_PAGAMENTO.filter((f) => itens.some((i) => i.forma_pagamento === f));
  const selo = mes.status === "aberta" || mes.status === "enviada" ? "PRÉVIA — MÊS AINDA NÃO APROVADO" : null;

  return (
    <>
      <BotaoImprimir />
      <article className="relatorio">
        <header className="mb-4 flex items-start justify-between gap-4 border-b-2 border-black pb-3">
          <p className="text-[16px] font-bold uppercase leading-tight">Relatório de vale-transporte — {rotuloMes(mes.competencia)}</p>
          <div className="text-right text-[11px]">
            <p>Pagamento {formatarData(mes.data_pagamento)} · {mes.dias_uteis_padrao} dias úteis · {ROTULO_STATUS[mes.status]}</p>
            {selo && <p className="mt-1 inline-block border-2 border-black px-2 py-0.5 text-[12px] font-bold tracking-wide">{selo}</p>}
          </div>
        </header>
        {empresas.map((emp) => {
          const linhas = itens.filter((i) => i.empregador === emp);
          return (
            <section key={emp} className="mb-4 break-inside-avoid-page">
              <h2 className="mb-1 text-[12px] font-bold uppercase">{emp}</h2>
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-black text-left">
                    <th className="w-16 py-0.5">Nº</th><th>Funcionário</th><th className="text-right">Valor total</th><th className="pl-4">Pagamento</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((i) => (
                    <tr key={i.id} className="border-b border-neutral-300 align-top">
                      <td className="py-0.5 tabular-nums">{i.cod_fornecedor}</td>
                      <td>{i.nome}</td>
                      <td className="text-right font-medium tabular-nums">{reais(i.valor)}</td>
                      <td className="pl-4">{ROTULO_FORMA[i.forma_pagamento]}</td>
                    </tr>
                  ))}
                  <tr className="font-bold"><td colSpan={2} className="py-0.5 text-right">Subtotal {emp}</td><td className="text-right tabular-nums">{reais(soma(linhas))}</td><td /></tr>
                </tbody>
              </table>
            </section>
          );
        })}
        <section className="break-inside-avoid-page">
          <table className="w-[360px] border-collapse text-[11px]">
            <tbody>
              {formas.map((f) => (
                <tr key={f}><td className="py-0.5 pr-4">{ROTULO_FORMA[f]}</td><td className="text-right tabular-nums">{reais(soma(itens.filter((i) => i.forma_pagamento === f)))}</td></tr>
              ))}
              <tr className="border-t border-black font-bold"><td className="py-0.5">Total do mês</td><td className="text-right tabular-nums">{reais(soma(itens))}</td></tr>
            </tbody>
          </table>
        </section>
      </article>
    </>
  );
}
