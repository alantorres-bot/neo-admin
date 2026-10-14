import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/app/(impressao)/imprimir/contas-pagar/autorizacao/[id]/botao-imprimir";
import { lerItens, lerMes, ROTULO_STATUS, type ItemLinha } from "@/app/(plataforma)/rh/vale_transporte/dados";
import { rotuloMes } from "@/lib/modulos/rh/vale-transporte/calendario";
import { MODULO_VT, ROTULO_FORMA } from "@/lib/modulos/rh/vale-transporte/modulo";
import { formatarData } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Relatório de vale-transporte" };

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const soma = (l: ItemLinha[]) => l.reduce((s, i) => s + Math.round(i.valor * 100), 0) / 100;

/** "RELATÓRIO DE VALE TRANSPORTE - <MÊS>", como a aba da planilha, por empresa, com subtotais por empresa e por forma de pagamento. */
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
  const formas = [...new Set(itens.map((i) => i.forma_pagamento))];
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
              <table className="w-full border-collapse text-[10px]">
                <thead>
                  <tr className="border-b border-black text-left">
                    <th className="py-0.5">Nº</th><th>Funcionário</th><th className="text-right">Dias úteis</th><th className="text-right">Faltas</th><th className="text-right">Atest.</th>
                    <th className="text-right">Extras</th><th className="text-right">Férias/afast.</th><th className="text-right">Abat.</th><th className="text-right">Passagens</th>
                    <th className="text-right">Vr. unitário</th><th className="text-right">Valor total</th><th className="pl-2">Pagamento</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((i) => (
                    <tr key={i.id} className="border-b border-neutral-300 align-top">
                      <td className="py-0.5 tabular-nums">{i.cod_fornecedor}</td>
                      <td>{i.nome}{i.sem_vt ? ` (sem VT: ${i.sem_vt_motivo})` : ""}{i.abat_motivo ? ` (abat.: ${i.abat_motivo})` : ""}</td>
                      <td className="text-right tabular-nums">{i.dias_uteis}</td>
                      <td className="text-right tabular-nums">{i.faltas || ""}</td>
                      <td className="text-right tabular-nums">{i.atestados || ""}</td>
                      <td className="text-right tabular-nums">{i.extras || ""}</td>
                      <td className="text-right tabular-nums">{i.dias_ferias + i.dias_afastamento || ""}</td>
                      <td className="text-right tabular-nums">{[i.abat_dias ? `${i.abat_dias}d` : "", i.abat_valor ? reais(i.abat_valor) : ""].filter(Boolean).join(" ")}</td>
                      <td className="text-right tabular-nums">{i.valor_fixo === null ? i.dias_pagos * i.passagens_dia : `${i.dias_pagos}d`}</td>
                      <td className="text-right tabular-nums">{i.valor_fixo === null ? reais(i.tarifa ?? 0) : `fixo ${reais(i.valor_fixo)}`}</td>
                      <td className="text-right font-medium tabular-nums">{reais(i.valor)}</td>
                      <td className="pl-2">{ROTULO_FORMA[i.forma_pagamento]}</td>
                    </tr>
                  ))}
                  <tr className="font-bold"><td colSpan={10} className="py-0.5 text-right">Subtotal {emp}</td><td className="text-right tabular-nums">{reais(soma(linhas))}</td><td /></tr>
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
