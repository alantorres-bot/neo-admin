import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CHAVE_DESTINATARIOS, MODULO_FILIAL, ROTA_FILIAL } from "@/lib/modulos/financeiro/filial/arquivos";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { CHAVES_AKF } from "../../akf/solicitacoes/dados";
import { EnvioEmLote } from "./componentes";

export const metadata: Metadata = { title: "Enviar faturas da filial" };

export default async function PaginaEnviarFaturas() {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_FILIAL);
  if (!modulo || !modulo.ativo || !temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_FILIAL, "operador")) notFound();

  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("configuracoes").select("chave, valor").in("chave", [CHAVES_AKF.semBoleto, CHAVE_DESTINATARIOS]);
  const lista = (chave: string) => {
    const v = (data ?? []).find((c) => c.chave === chave)?.valor;
    return Array.isArray(v) ? (v as unknown[]).filter((t): t is string => typeof t === "string" && t.trim() !== "") : [];
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" render={<Link href={ROTA_FILIAL} />}><ArrowLeft /> Faturamento Filial</Button>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Enviar faturas da filial</h1>
        <p className="text-sm text-muted-foreground">
          Cada envio vira uma remessa e cada NF, um kit. Os arquivos ficam aqui: Cuiabá recebe só o aviso por e-mail (relação e link
          da remessa), baixa as notas, implanta no Consistem e anexa o boleto; aí o kit fica pronto para você enviar ao cliente.
        </p>
      </div>
      <EnvioEmLote termosSemBoleto={lista(CHAVES_AKF.semBoleto)} para={lista(CHAVE_DESTINATARIOS)} hoje={hojeEmCuiaba()} />
    </div>
  );
}
