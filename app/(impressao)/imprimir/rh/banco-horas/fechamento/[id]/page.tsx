import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/app/(impressao)/imprimir/contas-pagar/autorizacao/[id]/botao-imprimir";
import { lerFechamento, ROTULO_FECHAMENTO } from "@/app/(plataforma)/rh/banco_horas/dados";
import { MODULO_BANCO_HORAS } from "@/lib/modulos/rh/banco-horas/modulo";
import { horas } from "@/lib/modulos/rh/ponto/modulo";
import { formatarData, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export const metadata: Metadata = { title: "Fechamento do banco de horas" };

const cpf = (c: string) => c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
const mais = (iso: string, meses: number) => { const [a, m] = iso.split("-").map(Number); return new Date(Date.UTC(a, m - 1 + meses, 25)).toISOString().slice(0, 10); };

const CEL = "border-b border-zinc-300 px-2 py-1";

function Bloco({ titulo, subtitulo, linhas }: { titulo: string; subtitulo: string; linhas: { chave: string; nome: string; doc: string; setor: string; horas: string; obs: string }[] }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="border-b-2 border-zinc-900 pb-1 text-[15px] font-bold">{titulo}</h2>
      <p className="text-[11px] text-zinc-700">{subtitulo}</p>
      {linhas.length === 0 ? <p className="italic text-zinc-600">Ninguém.</p> : (
        <table className="w-full border-collapse">
          <thead><tr className="text-left text-[11px] text-zinc-600"><th className={CEL}>Funcionário</th><th className={CEL}>CPF</th><th className={CEL}>Setor</th><th className={`${CEL} text-right`}>Horas</th><th className={CEL}>Origem</th></tr></thead>
          <tbody>{linhas.map((l) => <tr key={l.chave}><td className={CEL}>{l.nome}</td><td className={`${CEL} tabular-nums`}>{l.doc}</td><td className={CEL}>{l.setor}</td><td className={`${CEL} text-right font-bold tabular-nums`}>{l.horas}</td><td className={CEL}>{l.obs}</td></tr>)}</tbody>
        </table>
      )}
    </section>
  );
}

/**
 * Relatório do fechamento do ciclo para a folha (vai ao escritório contábil): quem a empresa paga, quem é descontado e quem
 * precisa compensar até o próximo dia 25. Linguagem simples, com a regra no rodapé.
 */
export default async function PaginaRelatorioFechamento({ params }: PageProps<"/imprimir/rh/banco-horas/fechamento/[id]">) {
  const sessao = await exigirSessao();
  if (!temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_BANCO_HORAS)) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await criarClienteServidor();
  const lido = await lerFechamento(supabase, id);
  if (!lido) notFound();
  const { fechamento: f, itens } = lido;
  const mes = formatarData(f.competencia).slice(3);
  const proximo = mais(f.competencia, 1);
  // quem vence no próximo dia 25 (aviso ao líder): horas a folgar ou a repor
  const { data: aVencer } = await supabase.from("rh_bh_aberto").select("pessoa_id, sinal, restante").eq("vencimento", proximo);
  const { data: pessoas } = await supabase.from("rh_bh_pessoas").select("id, nome, setor:rh_pt_setores(nome)");
  const nomeDe = new Map((pessoas ?? []).map((p) => [p.id as string, { nome: p.nome as string, setor: ((Array.isArray(p.setor) ? p.setor[0] : p.setor) as { nome: string } | null)?.nome ?? "" }]));
  const compensar = [...((aVencer ?? []) as { pessoa_id: string; sinal: number; restante: number }[]).reduce((m, a) => {
    const x = m.get(a.pessoa_id) ?? { folgar: 0, repor: 0 };
    if (a.sinal === 1) x.folgar += a.restante; else x.repor += a.restante;
    return m.set(a.pessoa_id, x);
  }, new Map<string, { folgar: number; repor: number }>()).entries()].map(([pid, v]) => ({ ...nomeDe.get(pid)!, ...v })).sort((a, b) => a.nome.localeCompare(b.nome));
  const pagar = itens.filter((i) => i.pagar_min > 0);
  const descontar = itens.filter((i) => i.descontar_min > 0);

  return (
    <>
      <title>{`Banco de horas - fechamento ${mes}`}</title>
      <BotaoImprimir />
      <article className="relatorio flex flex-col gap-5 text-[12px] leading-snug text-zinc-900">
        <header className="flex items-start justify-between gap-6 border-b-2 border-zinc-900 pb-3">
          <div className="flex flex-col gap-1.5">
            <Image src="/neo-formas-logo-horizontal.png" alt="Neo Formas para concreto" width={1792} height={291} className="mb-2 self-start" style={{ width: 240, height: "auto" }} priority unoptimized />
            <h1 className="text-[22px] font-bold tracking-tight">Banco de horas — fechamento da folha de {mes}</h1>
            <p className="text-[13px] text-zinc-700">Ciclo de {formatarData(mais(f.competencia, -1)).replace(/^25/, "26")} a {formatarData(mais(f.competencia, 0))}. Horas vencidas até o dia 25.</p>
          </div>
          <div className="flex flex-col items-end gap-1 text-right text-[11px] text-zinc-700">
            {f.status !== "aprovado" && f.status !== "enviado" && f.status !== "lancado" && <span className="border-2 border-zinc-900 px-2 py-0.5 font-bold">{ROTULO_FECHAMENTO[f.status].toUpperCase()}</span>}
            <span>RH · Banco de horas</span>
            <span>Emitido por {f.emitido_por_nome} em {formatarData(f.emitido_em.slice(0, 10))}</span>
            {f.aprovado_em && <span>Aprovado por {f.aprovado_por_nome} em {formatarData(f.aprovado_em.slice(0, 10))}</span>}
            <span>Impresso em {formatarData(hojeEmCuiaba())}</span>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-2.5">
          <div className="rounded-md border-2 border-zinc-900 px-3 py-2.5"><span className="text-[11px]">A EMPRESA PAGA (horas extras)</span><strong className="block text-[18px] tabular-nums">{horas(pagar.reduce((s, i) => s + i.pagar_min, 0))}</strong><span className="text-[11px]">{pagar.length} funcionário(s)</span></div>
          <div className="rounded-md border-2 border-zinc-900 px-3 py-2.5"><span className="text-[11px]">DESCONTAR NA FOLHA</span><strong className="block text-[18px] tabular-nums">{horas(descontar.reduce((s, i) => s + i.descontar_min, 0))}</strong><span className="text-[11px]">{descontar.length} funcionário(s)</span></div>
        </section>

        <Bloco titulo={`1. A EMPRESA PAGA — horas extras na folha de ${mes}`} subtitulo="Horas trabalhadas a mais que não foram folgadas no prazo de 6 meses. Pagar como hora extra."
          linhas={pagar.map((i) => ({ chave: i.pessoa_id, nome: i.nome, doc: cpf(i.cpf), setor: i.setor ?? "", horas: horas(i.pagar_min), obs: i.ciclos ? `ciclos ${i.ciclos}` : "" }))} />
        <Bloco titulo={`2. DESCONTAR NA FOLHA DE ${mes}`} subtitulo="Horas trabalhadas a menos que não foram repostas no prazo de 6 meses. Descontar na folha."
          linhas={descontar.map((i) => ({ chave: i.pessoa_id, nome: i.nome, doc: cpf(i.cpf), setor: i.setor ?? "", horas: horas(i.descontar_min), obs: i.ciclos ? `ciclos ${i.ciclos}` : "" }))} />
        <Bloco titulo={`3. PRECISA COMPENSAR ATÉ ${formatarData(proximo)} (aviso; não vai para a folha agora)`} subtitulo="Horas que vencem no próximo fechamento. O líder deve programar folga (a folgar) ou trabalho a mais (a repor)."
          linhas={compensar.map((c, i) => ({ chave: `${c.nome}-${i}`, nome: c.nome, doc: "", setor: c.setor, horas: [c.folgar && `${horas(c.folgar)} a folgar`, c.repor && `${horas(c.repor)} a repor`].filter(Boolean).join(" · "), obs: "" }))} />

        <section className="rounded-md border border-zinc-400 px-3 py-2 text-[11px]">
          <strong>Como ler este relatório.</strong> Horas a mais: o funcionário tem até o dia 25 do 6º mês depois do mês em que fez as horas para folgar; o que sobra, a empresa
          paga (bloco 1). Horas a menos: mesmo prazo para repor; o que sobra é descontado (bloco 2). O mais antigo é acertado primeiro. Os valores em R$ são calculados pela
          folha. Depois do lançamento na folha, o RH marca &quot;Lançado na folha&quot; no Neo Admin e essas horas saem do saldo.
        </section>

        <section className="mt-6 grid grid-cols-2 gap-10 text-center text-[11px]">
          <div className="border-t border-zinc-900 pt-1">RH (emissão)</div>
          <div className="border-t border-zinc-900 pt-1">Gestor do RH (aprovação)</div>
        </section>
      </article>
    </>
  );
}
