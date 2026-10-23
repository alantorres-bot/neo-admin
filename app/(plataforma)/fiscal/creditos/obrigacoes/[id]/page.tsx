import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Input } from "@/components/ui/input";
import { competencia, data, dataHora } from "@/lib/modulos/fiscal/creditos/formatos";
import { pode, proximasSituacoes, ROTA_CREDITOS, ROTULO_STATUS_OBRIGACAO, STATUS_OBRIGACAO_FINAIS, type StatusObrigacao } from "@/lib/modulos/fiscal/creditos/modulo";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { mudarSituacaoObrigacao, retificarObrigacao } from "../../acoes";
import { DocumentosVinculados, Historico } from "../../blocos";
import { Secao, Selo, tomObrigacao } from "../../componentes";
import { contexto, lerCadastros, lerHistorico, nomes } from "../../dados";
import { FormTarefa } from "../../formularios";
import { Campo, FormularioAcao, TEXTAREA } from "../../ui";
import { FormObrigacao } from "../formulario";

export const metadata: Metadata = { title: "Obrigação" };

export default async function PaginaObrigacao({ params }: PageProps<"/fiscal/creditos/obrigacoes/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, papel, sessao, autoaprova } = await contexto();
  const [{ data: o }, cad] = await Promise.all([supabase.from("fis_obrigacoes").select("*").eq("id", id).maybeSingle(), lerCadastros()]);
  if (!o) notFound();
  const [hist, { data: eventos }, { data: retif }] = await Promise.all([
    lerHistorico(supabase, "obrigacao", id),
    supabase.from("fis_obrigacoes_eventos").select("de, para, observacao, usuario_id, em").eq("obrigacao_id", id).order("em"),
    supabase.from("fis_obrigacoes").select("id, status").eq("retificadora_de", id).maybeSingle(),
  ]);
  const n = nomes(cad);
  const tipo = cad.tiposObrigacao.find((t) => t.id === o.tipo_id);
  const hoje = hojeEmCuiaba();
  const status = o.status as StatusObrigacao;
  const atrasada = !STATUS_OBRIGACAO_FINAIS.includes(status) && !!o.vencimento && o.vencimento < hoje;
  const temRecibo = hist.documentos.some((d) => d.tipo === "recibo_transmissao" || d.tipo === "protocolo");
  const temArquivo = hist.documentos.some((d) => d.tipo === "arquivo_declaracao");
  const autoconferencia = status === "transmitida" && o.transmitida_por === sessao.userId && autoaprova;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`${ROTA_CREDITOS}/obrigacoes`} className="text-elo hover:underline">← Obrigações</Link>
        <h2 className="font-condensada text-xl font-bold">{tipo?.nome} · {competencia(o.competencia)} · {n.estab.get(o.estabelecimento_id)}</h2>
        <Selo tom={tomObrigacao(status, atrasada)}>{ROTULO_STATUS_OBRIGACAO[status]}{atrasada ? " · atrasada" : ""}</Selo>
        {o.ficticio && <Selo>Dado fictício (demonstração)</Selo>}
      </div>
      {temArquivo && !["transmitida", "entregue_conferida", "retificada"].includes(status) && (
        <p className="rounded-[3px] border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
          ! Há arquivo da declaração salvo, mas a obrigação <strong>não consta como transmitida</strong>: registre a transmissão com o recibo/protocolo.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Secao titulo="Dados" acoes={pode(papel, "lancar") && !STATUS_OBRIGACAO_FINAIS.includes(status) ? <FormObrigacao cad={cad} o={o} /> : undefined}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Empresa</dt><dd>{n.empresa.get(o.empresa_id)}</dd>
            <dt className="text-muted-foreground">Tributo</dt><dd>{o.tributo_id ? n.tributo.get(o.tributo_id) : "—"}</dd>
            <dt className="text-muted-foreground">Vencimento</dt><dd>{o.vencimento ? data(o.vencimento) : "não cadastrado"} {o.vencimento_confirmado ? <Selo tom="bom">confirmado</Selo> : <Selo tom="atencao">a confirmar</Selo>}{o.vencimento_fonte ? <span className="block text-xs text-muted-foreground">{o.vencimento_fonte}</span> : null}</dd>
            <dt className="text-muted-foreground">Responsável</dt><dd>{o.responsavel_id ? n.usuario.get(o.responsavel_id) : "—"}</dd>
            <dt className="text-muted-foreground">Contador</dt><dd>{o.contador_responsavel ?? "—"}</dd>
            <dt className="text-muted-foreground">Preparação</dt><dd>{data(o.data_preparacao) || "—"}</dd>
            <dt className="text-muted-foreground">Revisão</dt><dd>{data(o.data_revisao) || "—"}</dd>
            <dt className="text-muted-foreground">Transmissão</dt><dd>{o.data_transmissao ? `${data(o.data_transmissao)} por ${o.transmitida_por ? n.usuario.get(o.transmitida_por) : "sistema"}` : "—"}</dd>
            <dt className="text-muted-foreground">Recibo/protocolo</dt><dd>{o.numero_recibo ?? "—"}</dd>
            <dt className="text-muted-foreground">Conferência</dt><dd>{o.conferida_em ? `${o.conferida_por ? n.usuario.get(o.conferida_por) : "sistema"} em ${dataHora(o.conferida_em)}` : "—"}</dd>
            {o.justificativa_dispensa && <><dt className="text-muted-foreground">Dispensa</dt><dd>{o.justificativa_dispensa}</dd></>}
            {o.retificadora_de && <><dt className="text-muted-foreground">Retifica</dt><dd><Link className="text-elo hover:underline" href={`${ROTA_CREDITOS}/obrigacoes/${o.retificadora_de}`}>declaração original</Link></dd></>}
            {retif && <><dt className="text-muted-foreground">Retificada por</dt><dd><Link className="text-elo hover:underline" href={`${ROTA_CREDITOS}/obrigacoes/${retif.id}`}>retificadora ({retif.status})</Link></dd></>}
            <dt className="text-muted-foreground">Observações</dt><dd className="whitespace-pre-wrap">{o.observacoes ?? "—"}</dd>
          </dl>
        </Secao>
        <Secao titulo="Fluxo da obrigação" descricao={tipo?.exige_recibo ? `Para transmitir: estar "Pronta para transmissão" e ter vinculado: ${tipo.documentos_exigidos.map((d) => n.tipoDoc.get(d) ?? d).join(", ")}.` : undefined}>
          <div className="flex flex-wrap gap-2">
            {pode(papel, "lancar") && proximasSituacoes(status).map((para) => (
              <FormularioAcao key={para} titulo={`Mudar para "${ROTULO_STATUS_OBRIGACAO[para]}"`} botao={ROTULO_STATUS_OBRIGACAO[para]} tamanho="xs"
                variante={para === "transmitida" || para === "entregue_conferida" ? "default" : "outline"} acao={mudarSituacaoObrigacao} ocultos={{ id, para }} rotuloSalvar="Confirmar"
                descricao={para === "transmitida" ? (temRecibo ? "Informe a data e o número do recibo/protocolo da entrega." : "Antes, anexe e vincule o recibo de transmissão (abaixo).")
                  : para === "entregue_conferida" ? (autoconferencia ? "Autoaprovação: você registrou a transmissão; justifique a conferência (fica gravada como [autoaprovação])." : "Conferência por outra pessoa (revisor/contador/admin), diferente de quem registrou a transmissão.")
                  : para === "pronta_transmissao" ? "Aprovação para transmitir (revisor/contador/admin)." : para === "dispensada" ? "Dispensa exige justificativa e revisor/contador/admin." : undefined}>
                {para === "transmitida" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Campo rotulo="Data da transmissão *" htmlFor={`tx-d-${para}`}><Input id={`tx-d-${para}`} name="data_transmissao" type="date" required max={hoje} /></Campo>
                    <Campo rotulo="Nº do recibo/protocolo *" htmlFor={`tx-r-${para}`}><Input id={`tx-r-${para}`} name="numero_recibo" required /></Campo>
                  </div>
                )}
                {para === "dispensada"
                  ? <Campo rotulo="Justificativa *" htmlFor="tx-j"><textarea id="tx-j" name="justificativa" required minLength={15} className={TEXTAREA} /></Campo>
                  : para === "entregue_conferida" && autoconferencia
                    ? <Campo rotulo="Justificativa da autoaprovação *" htmlFor="tx-o-auto"><textarea id="tx-o-auto" name="observacao" required minLength={10} className={TEXTAREA} /></Campo>
                    : <Campo rotulo="Observação" htmlFor={`tx-o-${para}`}><textarea id={`tx-o-${para}`} name="observacao" className={TEXTAREA} /></Campo>}
              </FormularioAcao>
            ))}
            {pode(papel, "lancar") && ["transmitida", "entregue_conferida"].includes(status) && (
              <FormularioAcao titulo="Retificar" botao="Retificar" tamanho="xs" acao={retificarObrigacao} ocultos={{ id }} rotuloSalvar="Gerar retificadora"
                descricao="A original fica 'Retificada' (preservada) e nasce a retificadora em preparação.">
                <Campo rotulo="Motivo *" htmlFor="rt-m"><textarea id="rt-m" name="motivo" required minLength={10} className={TEXTAREA} /></Campo>
              </FormularioAcao>
            )}
            {status === "transmitida" && o.transmitida_por === sessao.userId && !autoaprova && <span className="text-xs text-muted-foreground">A conferência deve ser feita por outra pessoa.</span>}
            {pode(papel, "lancar") && <FormTarefa cad={cad} empresa={o.empresa_id} alvo="obrigacao" alvoId={id} botao="Atribuir tarefa" tituloPadrao={`${tipo?.nome} ${competencia(o.competencia)}`} />}
          </div>
          <ol className="mt-3 space-y-1 border-t pt-2 text-xs">
            {(eventos ?? []).map((e, i) => (
              <li key={i}>{dataHora(e.em)} · {e.usuario_id ? n.usuario.get(e.usuario_id) : "sistema"} · {e.de ? `${ROTULO_STATUS_OBRIGACAO[e.de as StatusObrigacao]} → ` : ""}<strong>{ROTULO_STATUS_OBRIGACAO[e.para as StatusObrigacao]}</strong>{e.observacao ? ` — ${e.observacao}` : ""}</li>
            ))}
          </ol>
        </Secao>
        <Secao titulo="Histórico e comentários">
          <Historico decisoes={hist.decisoes} comentarios={hist.comentarios} nomeUsuario={n.usuario} alvo="obrigacao" alvoId={id} papel={papel} />
        </Secao>
      </div>
      <Secao titulo="Documentos (arquivo da declaração, recibo, protocolo)" descricao="Arquivo salvo aqui não comprova transmissão: a situação só muda pelo fluxo acima.">
        <DocumentosVinculados docs={hist.documentos} cad={cad} papel={papel} empresa={o.empresa_id} alvo="obrigacao" alvoId={id} tipoPadrao={temRecibo ? "arquivo_declaracao" : "recibo_transmissao"} />
      </Secao>
    </div>
  );
}
