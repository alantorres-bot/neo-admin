import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/app/(impressao)/imprimir/contas-pagar/autorizacao/[id]/botao-imprimir";
import { lerMes, lerRecibos } from "@/app/(plataforma)/rh/folha/dados";
import { MODULO_FOLHA } from "@/lib/modulos/rh/folha/modulo";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { ReciboImpresso } from "../../recibo-impresso";

export const metadata: Metadata = { title: "Recibos de pagamento do mês" };

/** Todos os recibos avulsos (não cancelados) da folha do mês, um por folha A4. */
export default async function PaginaRecibosDoMes({ params }: PageProps<"/imprimir/rh/folha/recibos/[id]">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_FOLHA);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "rh")) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await criarClienteServidor();
  const mes = await lerMes(supabase, id);
  if (!mes) notFound();
  const [recibos, { data: empresa }] = await Promise.all([
    lerRecibos(supabase, { competencia: mes.competencia }),
    supabase.from("empresas").select("razao_social, cnpj").eq("codigo_erp", "1").maybeSingle(),
  ]);
  const empregador = { razao_social: empresa?.razao_social ?? "NEO FORMAS PARA CONCRETO LTDA", cnpj: empresa?.cnpj ?? null };
  return (
    <>
      <BotaoImprimir />
      {recibos.length === 0 ? <p>Nenhum recibo neste mês.</p> : recibos.map((r) => <ReciboImpresso key={r.id} r={r} empregador={empregador} />)}
    </>
  );
}
