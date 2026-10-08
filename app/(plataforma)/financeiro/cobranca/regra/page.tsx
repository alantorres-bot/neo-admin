import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MODULO_RECEBIVEIS } from "@/lib/modulos/financeiro/recebiveis/boleto";
import { carregarRegra } from "@/lib/modulos/financeiro/recebiveis/regra";
import { FUSO, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { JUROS_MES_PADRAO_PCT, MULTA_PADRAO_PCT } from "@/supabase/functions/_shared/cobranca";
import { MODULO_COBRANCA } from "../fila";
import { FormRegra } from "./form-regra";

export const metadata: Metadata = { title: "Regra de cobrança — Cobrança" };

const quando = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
};

/** Regra de cobrança: mostra as regras em vigor e, para o gestor do Financeiro ou acima, deixa alterar os parâmetros e os marcos. */
export default async function PaginaRegraCobranca() {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_COBRANCA);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();
  const podeEditar = temAcesso(sessao.acesso, "financeiro", "gestor");

  const supabase = await criarClienteServidor();
  const [{ parametros, marcos, ultimaAlteracao }, { data: abertas }] = await Promise.all([
    carregarRegra(supabase),
    // Pendências "Cobrar D+n" abertas: o editor avisa quantas serão canceladas se um marco sair.
    podeEditar
      ? supabase.from("pendencias").select("titulo").eq("modulo", MODULO_RECEBIVEIS).eq("referencia_tabela", "contrapartes")
        .like("titulo", "Cobrar D+%").in("status", ["aberta", "em_andamento"]).limit(1000)
      : Promise.resolve({ data: [] as { titulo: string }[] }),
  ]);
  const abertasPorMarco: Record<number, number> = {};
  for (const p of abertas ?? []) {
    const dias = Number(/^Cobrar D\+(\d+):/.exec(p.titulo as string)?.[1] ?? NaN);
    if (Number.isInteger(dias)) abertasPorMarco[dias] = (abertasPorMarco[dias] ?? 0) + 1;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Regra de cobrança</h2>
        <p className="text-sm text-muted-foreground">
          Como o sistema decide o que entra em cada etapa. O sistema nunca envia nada ao cliente: ele prepara a tarefa e a mensagem, e quem envia é a pessoa.
        </p>
      </div>
      <FormRegra
        parametros={parametros}
        marcos={marcos}
        podeEditar={podeEditar}
        multaPct={MULTA_PADRAO_PCT}
        jurosMesPct={JUROS_MES_PADRAO_PCT}
        abertasPorMarco={abertasPorMarco}
        hoje={hojeEmCuiaba()}
        ultimaAlteracao={ultimaAlteracao ? `${ultimaAlteracao.por}, em ${quando(ultimaAlteracao.em)}` : null}
      />
    </div>
  );
}
