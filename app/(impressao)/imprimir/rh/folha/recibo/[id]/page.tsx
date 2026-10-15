import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/app/(impressao)/imprimir/contas-pagar/autorizacao/[id]/botao-imprimir";
import { lerRecibos } from "@/app/(plataforma)/rh/folha/dados";
import { MODULO_FOLHA } from "@/lib/modulos/rh/folha/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { ReciboImpresso } from "../../recibo-impresso";

export const metadata: Metadata = { title: "Recibo de pagamento" };

export default async function PaginaRecibo({ params }: PageProps<"/imprimir/rh/folha/recibo/[id]">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_FOLHA);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "rh")) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await criarClienteServidor();
  const [recibos, { data: empresa }] = await Promise.all([
    lerRecibos(supabase, { id, incluirCancelados: true }),
    supabase.from("empresas").select("razao_social, cnpj").eq("codigo_erp", "1").maybeSingle(),
  ]);
  const r = recibos[0];
  if (!r) notFound();
  return (
    <>
      <BotaoImprimir />
      {r.cancelado && <p className="mb-2 border-2 border-black p-2 text-center text-[13px] font-bold">RECIBO CANCELADO — {r.cancelado_motivo}</p>}
      <ReciboImpresso r={r} empregador={{ razao_social: empresa?.razao_social ?? "NEO FORMAS PARA CONCRETO LTDA", cnpj: empresa?.cnpj ?? null }} />
    </>
  );
}
