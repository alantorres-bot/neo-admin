import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROTA_AKF } from "@/lib/modulos/financeiro/akf/solicitacao";
import { formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/carteira";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { ROTULO_UNIDADE, type Unidade } from "@/supabase/functions/_shared/cobranca";
import { lerDestinatariosAkf, lerParametrosAkf, lerTitulosParaSolicitar } from "../solicitacoes/dados";
import { Seletor } from "./seletor";

export const metadata: Metadata = { title: "Solicitar antecipação à AKF" };

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PaginaSolicitar({ searchParams }: PageProps<"/financeiro/akf/solicitar">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === "financeiro.akf");
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro", "operador")) notFound();

  const parametros = await searchParams;
  const unidadePedida = primeiro(parametros.unidade);
  const unidade: Unidade | null = unidadePedida === "matriz" || unidadePedida === "contagem" ? unidadePedida : null;

  const supabase = await criarClienteServidor();
  const parametrosAkf = await lerParametrosAkf(supabase);
  const [titulos, { contraparteNome, destinatarios }] = await Promise.all([
    lerTitulosParaSolicitar(supabase, parametrosAkf, unidade),
    lerDestinatariosAkf(supabase, parametrosAkf.contraparteId),
  ]);
  const livres = titulos.filter((t) => !t.solicitacao);
  const totalLivre = livres.reduce((s, t) => s + t.restanteCentavos, 0);
  const href = (u: Unidade | null) => `${ROTA_AKF}/solicitar${u ? `?unidade=${u}` : ""}`;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" render={<Link href={ROTA_AKF} />}><ArrowLeft /> Voltar à AKF</Button>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Solicitar antecipação à AKF</h1>
          <Button variant="outline" size="sm" render={<Link href={`${ROTA_AKF}/solicitacoes`} />}>Solicitações anteriores</Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Títulos a vencer, ainda com a Neo, em estágio normal (os mesmos de &quot;Disponíveis para antecipar&quot;). Marque os que quer operar; para
          antecipar só uma parte, digite o valor. Clientes que não aceitam boleto de factoring já vêm com o selo <strong>Sem boleto</strong> (OBS automática
          no e-mail: {parametrosAkf.observacaoSemBoleto.toLowerCase().replace(/\.$/, "")}). O e-mail vai para{" "}
          {destinatarios.length > 0 ? destinatarios.map((d) => d.nome).join(" e ") : "— nenhum contato da AKF com e-mail —"}
          {contraparteNome ? ` (${contraparteNome})` : ""}{parametrosAkf.copia.length > 0 ? `, com cópia para ${parametrosAkf.copia.join(", ")}` : ""}, como rascunho no Gmail.
        </p>
      </div>

      <nav aria-label="Unidade" className="flex flex-wrap gap-px overflow-hidden rounded-[3px] border border-grade bg-grade sm:w-fit">
        {([{ u: null as Unidade | null, rotulo: "Todas as unidades" }, { u: "matriz" as Unidade | null, rotulo: ROTULO_UNIDADE.matriz }, { u: "contagem" as Unidade | null, rotulo: ROTULO_UNIDADE.contagem }]).map((o) => {
          const ativa = o.u === unidade;
          return (
            <Link key={o.u ?? "todas"} href={href(o.u)} aria-current={ativa ? "page" : undefined} className={`min-w-44 px-4 py-2 text-[13px] ${ativa ? "border-b-2 border-marca bg-white font-bold" : "bg-cabecalho hover:bg-white"}`}>
              {o.rotulo}
            </Link>
          );
        })}
      </nav>

      <p className="text-sm text-muted-foreground">
        {livres.length} {livres.length === 1 ? "título disponível" : "títulos disponíveis"} · {formatarMoeda(totalLivre)}
        {titulos.length > livres.length && <> · {titulos.length - livres.length} já em solicitação aberta</>}
      </p>

      {titulos.length === 0
        ? <p className="rounded-[3px] border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum título disponível para antecipar.</p>
        : <Seletor key={`${unidade}-${titulos.map((t) => t.id + (t.solicitacao?.numero ?? "")).join(",")}`} titulos={titulos} hoje={hojeEmCuiaba()} temDestinatario={destinatarios.length > 0} />}
    </div>
  );
}
