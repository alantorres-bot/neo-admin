import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { carregarRegra } from "@/lib/modulos/financeiro/recebiveis/regra";
import { FUSO } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { JUROS_MES_PADRAO_PCT, MARCOS_COBRANCA, MULTA_PADRAO_PCT, type CanalCobranca } from "@/supabase/functions/_shared/cobranca";
import { MODULO_COBRANCA } from "../fila";
import { FormRegra } from "./form-regra";

export const metadata: Metadata = { title: "Regra de cobrança — Cobrança" };

const ROTULO_CANAL: Record<CanalCobranca, string> = { email: "e-mail", whatsapp: "WhatsApp" };

const quando = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
};

/** Regra de cobrança: mostra as regras em vigor e, para o gestor do Financeiro ou acima, deixa alterar os parâmetros. */
export default async function PaginaRegraCobranca() {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_COBRANCA);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();

  const { parametros, ultimaAlteracao } = await carregarRegra(await criarClienteServidor());

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
        podeEditar={temAcesso(sessao.acesso, "financeiro", "gestor")}
        marcos={MARCOS_COBRANCA.map((m) => ({ nome: m.nome, descricao: m.descricao, canais: m.canais.map((c) => ROTULO_CANAL[c]).join(" e ") }))}
        multaPct={MULTA_PADRAO_PCT}
        jurosMesPct={JUROS_MES_PADRAO_PCT}
        ultimaAlteracao={ultimaAlteracao ? `${ultimaAlteracao.por}, em ${quando(ultimaAlteracao.em)}` : null}
      />
    </div>
  );
}
