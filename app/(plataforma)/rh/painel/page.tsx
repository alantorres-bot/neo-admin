import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { rotuloMes } from "@/lib/modulos/rh/calendario";
import { ROTA_FOLHA } from "@/lib/modulos/rh/folha/modulo";
import {
  checklistFechamento, diasAte, ETAPAS_FOLHA, etapaAtual, MODULO_PAINEL_RH, percentuais, rotuloEmpresa, saudacao, variacao, type EstadoItem,
} from "@/lib/modulos/rh/painel/painel";
import { formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { formatarData, FUSO, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerPainel } from "./dados";

export const metadata: Metadata = { title: "Painel do RH" };

// Visual renovado (V2 do design de 15/10/2026): cartões brancos sobre fundo cinza-claro; vermelho da marca só nos destaques.
const CARTAO = "rounded-[10px] border border-[#e7e5e2] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]";
const SOBRETITULO = "text-xs font-medium uppercase tracking-[0.08em] text-[#6b6b6b]";
const BOTAO = "inline-flex min-h-11 items-center rounded-md px-[18px] font-medium";
const COR = { salarios: "#2e2e2e", decimo: "#c8372f", avulso: "#8fb0d8" } as const;
const ESTADO: Record<EstadoItem, string> = {
  feito: "bg-[#e6f4ec] text-[#1e5f3b]", pendente: "bg-[#fff1dc] text-[#7a4300]", aguardando: "bg-[#f0eeeb] text-[#4a4a4a]", depois: "bg-[#f0eeeb] text-[#4a4a4a]",
};
const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mil = (centavos: number) => `${Math.round(centavos / 100_000).toLocaleString("pt-BR")} mil`;
const milhoesOuMil = (centavos: number) =>
  centavos >= 100_000_000 ? `R$ ${(centavos / 100_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi` : `R$ ${(centavos / 100_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;

export default async function PaginaPainelRh() {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_PAINEL_RH);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "rh")) notFound();
  const ehGestor = temAcesso(sessao.acesso, "rh", "gestor");
  const hoje = hojeEmCuiaba();
  const ano = Number(hoje.slice(0, 4));
  const supabase = await criarClienteServidor();
  const { meses, totais, fechamento, destaque, colaboradores, pendencias } = await lerPainel(supabase, ano);

  const agora = new Date();
  const hora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, hour: "2-digit", hourCycle: "h23" }).format(agora));
  const dataExtenso = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(agora);
  const paraHoje = pendencias.filter((p) => p.prazo && p.prazo <= hoje).length;

  const doAno = meses.map((m) => ({ m, t: totais.get(m.id) })).filter((x) => x.t && x.t.total > 0);
  const totalAno = doAno.reduce((s, x) => s + x.t!.total, 0);
  const decimoAno = doAno.reduce((s, x) => s + x.t!.decimo, 0);
  const maior = Math.max(1, ...doAno.map((x) => x.t!.total));
  const realce = destaque?.mes.id ?? doAno.at(-1)?.m.id;

  return (
    <div className="-m-3 min-h-full bg-[#f5f4f2] p-3 text-[#1f1f1f] sm:-m-4 sm:p-4 md:-m-5 md:p-5">
      <div className="mx-auto flex max-w-[1360px] flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[13px] text-[#6b6b6b] first-letter:uppercase">{dataExtenso}</p>
            <h1 className="font-condensada text-[34px] font-bold leading-tight tracking-[-0.01em]">{saudacao(hora)}, {sessao.perfil.nome.split(" ")[0]}</h1>
          </div>
          <p className="text-[#4a4a4a]">
            {paraHoje > 0 ? <>Você tem <strong className="text-[#a42c25]">{paraHoje} {paraHoje === 1 ? "pendência" : "pendências"} para hoje</strong></> : "Nenhuma pendência vence hoje"}
            {fechamento ? <> e a folha de {rotuloMes(fechamento.mes.competencia).toLowerCase()} está aberta.</> : "."}
          </p>
        </div>

        <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr))]">
          {fechamento ? <Fechamento {...fechamento} hoje={hoje} /> : (
            <section className={`${CARTAO} flex flex-col justify-center gap-3 p-6`}>
              <p className={SOBRETITULO}>Fechamento</p>
              <p className="text-[#4a4a4a]">Nenhuma folha aberta.</p>
              <Link href={`${ROTA_FOLHA}/meses`} className={`${BOTAO} self-start border border-[#d6d3ce]`}>Abrir a folha do mês</Link>
            </section>
          )}
          {destaque && <Destaque {...destaque} ehGestor={ehGestor} />}
        </div>

        <section aria-label="Números do ano" className="grid gap-px overflow-hidden rounded-[10px] border border-[#e7e5e2] bg-[#e7e5e2] [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
          <Numero rotulo={`Pago em ${ano}${doAno.length ? ` (${MES_CURTO[Number(doAno[0].m.competencia.slice(5, 7)) - 1]}–${MES_CURTO[Number(doAno.at(-1)!.m.competencia.slice(5, 7)) - 1]})` : ""}`} valor={milhoesOuMil(totalAno)} />
          <Numero rotulo="Média por mês" valor={doAno.length ? milhoesOuMil(Math.round(totalAno / doAno.length)) : "—"} />
          <Numero rotulo="Colaboradores ativos" valor={String(colaboradores.ativos)} extra={`· ${colaboradores.comVt} com VT`} />
          <Numero rotulo="13º 1ª parcela no ano" valor={milhoesOuMil(decimoAno)} />
        </section>

        <div className="flex flex-wrap items-stretch gap-5">
          <section aria-labelledby="h-grafico" className={`${CARTAO} min-w-0 flex-[3_1_560px] p-6`}>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 id="h-grafico" className="font-condensada text-xl font-bold">Folha mês a mês</h2>
              <Legenda />
            </div>
            {doAno.length === 0 ? <p className="text-sm text-[#6b6b6b]">Nenhuma folha com valor em {ano}.</p> : (
              <div className="overflow-x-auto">
                <div role="img" aria-label={`Total da folha por mês em ${ano}: ${doAno.map((x) => `${rotuloMes(x.m.competencia)} ${formatarMoeda(x.t!.total)}`).join("; ")}`} className="flex min-w-[520px] flex-col gap-2">
                  <div className="flex h-[250px] items-end gap-3.5 border-b border-[#d6d3ce]">
                    {doAno.map(({ m, t }) => {
                      const atual = m.id === realce;
                      const salarios = t!.total - t!.decimo - t!.avulso;
                      const h = (v: number) => `${Math.max(v > 0 ? 1 : 0, Math.round((v / maior) * 210))}px`;
                      return (
                        <Link key={m.id} href={`${ROTA_FOLHA}/mes/${m.id}`} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${rotuloMes(m.competencia)}: ${formatarMoeda(t!.total)}`}>
                          <span className={`whitespace-nowrap text-xs ${atual ? "font-bold text-[#1f1f1f]" : "text-[#6b6b6b]"}`}>{mil(t!.total)}</span>
                          <span className={`flex w-full max-w-12 flex-col overflow-hidden rounded-t ${atual ? "" : "opacity-55"}`}>
                            <span style={{ height: h(t!.avulso), background: COR.avulso }} />
                            <span style={{ height: h(t!.decimo), background: COR.decimo }} />
                            <span style={{ height: h(salarios), background: COR.salarios }} />
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                  <div className="flex gap-3.5">
                    {doAno.map(({ m }) => (
                      <span key={m.id} className={`flex-1 text-center text-xs capitalize ${m.id === realce ? "font-bold" : "text-[#4a4a4a]"}`}>{MES_CURTO[Number(m.competencia.slice(5, 7)) - 1]}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <p className="mt-4 text-xs text-[#6b6b6b]">Clique numa barra para abrir o mês. Até setembro/2026, histórico da planilha do RH (março, do Consistem).</p>
          </section>

          <section aria-labelledby="h-fila" className={`${CARTAO} flex min-w-0 flex-[2_1_380px] flex-col`}>
            <div className="flex items-center justify-between px-6 pb-3 pt-5">
              <h2 id="h-fila" className="font-condensada text-xl font-bold">Fila do RH</h2>
              <Link href="/inicio" className="text-[13px] text-elo hover:underline">Fila do dia</Link>
            </div>
            {pendencias.length === 0 ? <p className="px-6 pb-6 text-sm text-[#6b6b6b]">Nada pendente no RH.</p> : (
              <ul className="px-3 pb-3">
                {pendencias.map((p) => {
                  const urgente = p.criticidade !== "normal" || (p.prazo !== null && diasAte(hoje, p.prazo) <= 2);
                  const conteudo = (
                    <>
                      <span className={`flex size-[46px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg ${urgente ? "bg-[#fbe2df] text-[#8a241e]" : "bg-[#f0eeeb] text-[#3a3a3a]"}`}>
                        <span className="text-base font-bold leading-none">{p.prazo ? p.prazo.slice(8, 10) : "—"}</span>
                        <span className="text-[10px] uppercase tracking-[0.06em]">{p.prazo ? MES_CURTO[Number(p.prazo.slice(5, 7)) - 1] : ""}</span>
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-medium">{p.titulo}</span>
                        {p.descricao && <span className="truncate text-[13px] text-[#6b6b6b]">{p.descricao}</span>}
                      </span>
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-[#9a968f]" />
                    </>
                  );
                  return (
                    <li key={p.id}>
                      {p.link
                        ? <Link href={p.link} className="flex min-h-11 items-center gap-3.5 rounded-lg p-3 hover:bg-[#faf9f7]">{conteudo}</Link>
                        : <div className="flex min-h-11 items-center gap-3.5 p-3">{conteudo}</div>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Fechamento({ mes, situacao, hoje }: NonNullable<Awaited<ReturnType<typeof lerPainel>>["fechamento"]> & { hoje: string }) {
  const dias = diasAte(hoje, mes.data_pagamento);
  const etapa = etapaAtual(mes.status);
  const itens = checklistFechamento(situacao);
  return (
    <section aria-labelledby="h-fechamento" className={`${CARTAO} flex flex-col gap-[22px] p-6`}>
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <p className={SOBRETITULO}>Fechamento em andamento</p>
          <h2 id="h-fechamento" className="mt-1 font-condensada text-[26px] font-bold">Folha de {rotuloMes(mes.competencia).toLowerCase()}</h2>
        </div>
        <div className="text-right">
          <p className="font-condensada text-[40px] font-bold leading-none text-[#a42c25]">{Math.abs(dias)} <span className="text-lg font-semibold">{Math.abs(dias) === 1 ? "dia" : "dias"}</span></p>
          <p className="mt-1 text-[13px] text-[#6b6b6b]">{dias >= 0 ? "até o pagamento" : "de atraso no pagamento"}, {formatarData(mes.data_pagamento).slice(0, 5)}</p>
        </div>
      </div>
      <ol aria-label="Etapas da folha" className="grid grid-cols-4">
        {ETAPAS_FOLHA.map((e, i) => (
          <li key={e.status} className="flex flex-col gap-2" aria-current={i === etapa ? "step" : undefined}>
            <span className="flex items-center">
              <span className={`size-4 shrink-0 rounded-full ${i === etapa ? "bg-[#c8372f] shadow-[0_0_0_4px_#fbe2df]" : i < etapa ? "bg-[#1e7a4a]" : "border-2 border-[#c9c5bf] bg-white"}`} />
              {i < 3 && <span className={`mx-1.5 h-0.5 flex-1 ${i < etapa ? "bg-[#1e7a4a]" : "bg-[#e2dfda]"}`} />}
            </span>
            <span className={`text-[13px] ${i === etapa ? "font-bold" : "text-[#6b6b6b]"}`}>{e.nome}</span>
          </li>
        ))}
      </ol>
      <ul className="border-t border-[#efedea]">
        {itens.map((c) => (
          <li key={c.texto} className="flex items-center gap-3 border-b border-[#efedea] py-[11px]">
            {c.estado === "feito" ? (
              <svg width="20" height="20" viewBox="0 0 20 20" role="img" aria-label="Feito" className="shrink-0"><circle cx="10" cy="10" r="9" fill="#1e7a4a" /><path d="M6 10.5l2.6 2.6L14 7.6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" role="img" aria-label="Pendente" className="shrink-0"><circle cx="10" cy="10" r="8.5" fill="none" stroke="#b5b1ab" strokeWidth="1.5" /></svg>
            )}
            <span className="min-w-0 flex-1">{c.texto}</span>
            <span className={`shrink-0 rounded-full px-[9px] py-[3px] text-xs font-medium ${ESTADO[c.estado]}`}>{c.status}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2.5">
        <Link href={`${ROTA_FOLHA}/mes/${mes.id}`} className={`${BOTAO} bg-[#c8372f] text-white hover:bg-[#a42c25]`}>Abrir a folha do mês</Link>
        <Link href={`${ROTA_FOLHA}/recorrentes`} className={`${BOTAO} border border-[#d6d3ce] hover:bg-[#faf9f7]`}>Recibos recorrentes</Link>
      </div>
    </section>
  );
}

function Destaque({ mes, totais, anterior, ehGestor }: NonNullable<Awaited<ReturnType<typeof lerPainel>>["destaque"]> & { ehGestor: boolean }) {
  const t = totais ?? { total: 0, decimo: 0, avulso: 0, pessoas: 0, porEmpresa: {} };
  const salarios = t.total - t.decimo - t.avulso;
  const p = percentuais({ salarios, decimo: t.decimo, avulso: t.avulso });
  const v = variacao(t.total, anterior);
  const empresas = Object.keys(t.porEmpresa).sort();
  const porEmpresaTotal = (e: string) => t.porEmpresa[e] ?? 0;
  const titulo = mes.status === "conferida" ? (ehGestor ? "Aguardando sua aprovação" : "Aguardando aprovação do gestor")
    : mes.status === "aprovada" ? "Aprovada · aguardando pagamento" : "Última folha paga";
  const selo = { aberta: "Aberta", conferida: "Conferida", aprovada: "Aprovada", paga: "Paga" }[mes.status];
  return (
    <section aria-labelledby="h-destaque" className={`${CARTAO} flex flex-col gap-5 p-6`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className={SOBRETITULO}>{titulo}</p>
          <h2 id="h-destaque" className="mt-1 font-condensada text-[26px] font-bold">Folha de {rotuloMes(mes.competencia).toLowerCase()}</h2>
        </div>
        <span className="rounded-full bg-[#e8f0fa] px-2.5 py-1 text-xs font-medium text-[#1b4a80]">{selo}</span>
      </div>
      <div>
        <p className="font-condensada text-[44px] font-bold leading-none tracking-[-0.01em]">{formatarMoeda(t.total)}</p>
        <p className="mt-2 text-[#4a4a4a]">
          {v !== null && <><span className="font-medium text-[#8a2c1f]">{v > 0 ? "+" : ""}{v.toLocaleString("pt-BR")}%</span> sobre o mês anterior · </>}
          {t.pessoas} pessoas · pagamento até {formatarData(mes.data_pagamento)}
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <div aria-hidden className="flex h-3 overflow-hidden rounded-md bg-[#efedea]">
          <span style={{ width: `${p.salarios}%`, background: COR.salarios }} />
          <span style={{ width: `${p.decimo}%`, background: COR.decimo }} />
          <span style={{ width: `${p.avulso}%`, background: COR.avulso }} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Parte cor={COR.salarios} rotulo="Salários" valor={salarios} />
          <Parte cor={COR.decimo} rotulo="13º" valor={t.decimo} />
          <Parte cor={COR.avulso} rotulo="Avulsos" valor={t.avulso} />
        </div>
      </div>
      {empresas.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-[#efedea] bg-[#faf9f7] px-4 py-3.5">
          <p className="text-xs text-[#6b6b6b]">Folha do escritório por empresa (líquido + férias)</p>
          {empresas.map((e) => (
            <div key={e} className="flex justify-between gap-3"><span className="text-[#4a4a4a]">{rotuloEmpresa(e)}</span><span className="tabular-nums">{formatarMoeda(porEmpresaTotal(e))}</span></div>
          ))}
        </div>
      )}
      <div className="mt-auto flex flex-wrap gap-2.5">
        <Link href={`${ROTA_FOLHA}/mes/${mes.id}`} className={`${BOTAO} bg-[#1f1f1f] text-white hover:bg-black`}>{mes.status === "conferida" && ehGestor ? "Revisar e aprovar" : "Abrir o mês"}</Link>
        <a href={`/imprimir/rh/folha/${mes.id}`} target="_blank" rel="noreferrer" className={`${BOTAO} border border-[#d6d3ce] hover:bg-[#faf9f7]`}>Relatório</a>
      </div>
    </section>
  );
}

function Parte({ cor, rotulo, valor }: { cor: string; rotulo: string; valor: number }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs text-[#6b6b6b]"><span aria-hidden className="inline-block size-2 rounded-[2px]" style={{ background: cor }} />{rotulo}</p>
      <p className="mt-0.5 font-bold tabular-nums">{formatarMoeda(valor)}</p>
    </div>
  );
}

function Numero({ rotulo, valor, extra }: { rotulo: string; valor: string; extra?: string }) {
  return (
    <div className="bg-white px-5 py-[18px]">
      <p className="text-xs text-[#6b6b6b]">{rotulo}</p>
      <p className="mt-1 font-condensada text-[26px] font-bold">{valor}{extra && <span className="ml-1 font-sans text-sm font-normal text-[#6b6b6b]">{extra}</span>}</p>
    </div>
  );
}

function Legenda() {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-[#4a4a4a]">
      {([["Salários", COR.salarios], ["13º", COR.decimo], ["Avulsos", COR.avulso]] as const).map(([r, c]) => (
        <span key={r} className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block size-2.5 rounded-[2px]" style={{ background: c }} />{r}</span>
      ))}
    </div>
  );
}
