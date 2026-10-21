import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/app/(impressao)/imprimir/contas-pagar/autorizacao/[id]/botao-imprimir";
import { lerParametros, lerPessoa } from "@/app/(plataforma)/rh/banco_horas/dados";
import { MODULO_BANCO_HORAS } from "@/lib/modulos/rh/banco-horas/modulo";
import { horas } from "@/lib/modulos/rh/ponto/modulo";
import { formatarData, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Extrato do banco de horas" };

const cpf = (c: string) => c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");

/** Extrato do banco de horas de UM funcionário, para entregar e assinar: o que tem a folgar ou repor, até quando, e os movimentos. */
export default async function PaginaExtratoBanco({ params }: PageProps<"/imprimir/rh/banco-horas/extrato/[pessoa]">) {
  const sessao = await exigirSessao();
  if (!temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_BANCO_HORAS)) notFound();
  const { pessoa } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(pessoa)) notFound();
  const supabase = await criarClienteServidor();
  const [p, par] = await Promise.all([lerPessoa(supabase, pessoa), lerParametros(supabase)]);
  if (!p) notFound();
  const hoje = hojeEmCuiaba();
  const s = p.saldo;
  const folgar = p.aberto.filter((a) => a.sinal === 1);
  const repor = p.aberto.filter((a) => a.sinal === -1);
  const movs = p.movimentos.filter((m) => m.data >= par.inicio);
  const cel = "border-b border-zinc-300 px-2 py-1";

  return (
    <>
      <title>{`Extrato banco de horas - ${s.nome}`}</title>
      <BotaoImprimir />
      <article className="relatorio flex flex-col gap-4 text-[12px] leading-snug text-zinc-900">
        <header className="flex items-start justify-between gap-6 border-b-2 border-zinc-900 pb-3">
          <div className="flex flex-col gap-1.5">
            <Image src="/neo-formas-logo-horizontal.png" alt="Neo Formas para concreto" width={1792} height={291} className="mb-2 self-start" style={{ width: 240, height: "auto" }} priority unoptimized />
            <h1 className="text-[22px] font-bold tracking-tight">Extrato do banco de horas</h1>
            <p className="text-[13px] text-zinc-700">Desde {formatarData(par.inicio)} até {formatarData(s.saldo_em ?? hoje)}.</p>
          </div>
          <div className="flex flex-col items-end gap-1 text-right text-[11px] text-zinc-700"><span>RH · Banco de horas</span><span>Impresso em {formatarData(hoje)}</span></div>
        </header>

        <section className="flex flex-col gap-0.5">
          <span className="text-[11px] text-zinc-600">Funcionário</span>
          <strong className="text-[18px]">{s.nome}</strong>
          <span className="text-[11px] text-zinc-700">CPF {cpf(s.cpf)}{s.setor ? ` · ${s.setor}` : ""}</span>
        </section>

        <section className="grid grid-cols-3 gap-2.5">
          <div className="rounded-md border border-zinc-400 px-3 py-2.5"><span className="text-[11px]">Saldo</span><strong className="block text-[18px] tabular-nums">{horas(s.saldo_min)}</strong><span className="text-[11px]">{s.saldo_min >= 0 ? "horas a seu favor" : "horas que você deve"}</span></div>
          <div className="rounded-md border border-zinc-400 px-3 py-2.5"><span className="text-[11px]">Suas horas a FOLGAR</span><strong className="block text-[18px] tabular-nums">{horas(folgar.reduce((t, a) => t + a.restante, 0))}</strong></div>
          <div className="rounded-md border border-zinc-400 px-3 py-2.5"><span className="text-[11px]">Suas horas a REPOR</span><strong className="block text-[18px] tabular-nums">{horas(repor.reduce((t, a) => t + a.restante, 0))}</strong></div>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="border-b-2 border-zinc-900 pb-1 text-[15px] font-bold">Prazos</h2>
          {p.aberto.length === 0 ? <p className="italic">Nada em aberto.</p> : (
            <table className="w-full border-collapse">
              <thead><tr className="text-left text-[11px] text-zinc-600"><th className={cel}>Horas de</th><th className={cel}>Tipo</th><th className={`${cel} text-right`}>Horas</th><th className={cel}>Prazo</th><th className={cel}>Se não compensar até o prazo</th></tr></thead>
              <tbody>
                {p.aberto.map((a) => (
                  <tr key={`${a.data}-${a.sinal}`}>
                    <td className={`${cel} tabular-nums`}>{formatarData(a.data)}</td>
                    <td className={cel}>{a.sinal === 1 ? "A folgar" : "A repor"}</td>
                    <td className={`${cel} text-right font-bold tabular-nums`}>{horas(a.restante)}</td>
                    <td className={`${cel} tabular-nums`}>{formatarData(a.vencimento)}{a.vencimento < hoje ? " (vencido)" : ""}</td>
                    <td className={cel}>{a.sinal === 1 ? "A empresa paga como hora extra" : "É descontado na folha"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="border-b-2 border-zinc-900 pb-1 text-[15px] font-bold">Movimentos (Control iD)</h2>
          <table className="w-full border-collapse">
            <thead><tr className="text-left text-[11px] text-zinc-600"><th className={cel}>Dia</th><th className={`${cel} text-right`}>A mais</th><th className={`${cel} text-right`}>A menos</th></tr></thead>
            <tbody>{movs.map((m) => <tr key={m.data}><td className={`${cel} tabular-nums`}>{formatarData(m.data)}</td><td className={`${cel} text-right tabular-nums`}>{m.positivo_min ? horas(m.positivo_min) : ""}</td><td className={`${cel} text-right tabular-nums`}>{m.negativo_min ? horas(m.negativo_min) : ""}</td></tr>)}</tbody>
          </table>
          {p.lancamentos.filter((l) => !l.cancelado_em).map((l) => (
            <p key={l.id} className="text-[11px]">Folha de {formatarData(l.competencia).slice(3)}: {l.tipo === "pago" ? "a empresa pagou" : "foram descontadas"} {horas(l.minutos)}.</p>
          ))}
        </section>

        <section className="rounded-md border border-zinc-400 px-3 py-2 text-[11px]">
          <strong>Como funciona.</strong> Horas a mais: você tem até o dia 25 do 6º mês depois do mês em que fez as horas para folgar; o que sobrar, a empresa paga como hora
          extra. Horas a menos: mesmo prazo para repor; o que sobrar é descontado na folha. O mais antigo é acertado primeiro. Combine as folgas com o seu líder.
        </section>

        <section className="mt-8 grid grid-cols-2 gap-10 text-center text-[11px]">
          <div className="border-t border-zinc-900 pt-1">{s.nome}<br />Funcionário — ciente em ___/___/______</div>
          <div className="border-t border-zinc-900 pt-1">RH</div>
        </section>
      </article>
    </>
  );
}
