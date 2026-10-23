import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ROTA_INTIMACOES, ROTULO_STATUS, tarefaAdiantamento } from "@/lib/modulos/financeiro/intimacoes/intimacoes";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { AcaoComTexto, AprovarVencimento, BotaoAcao, ConsultaTitulos, FormDados, JuntarAoApontamento } from "../componentes";
import { lerIntimacao } from "../dados";

export const metadata: Metadata = { title: "Intimação de cartório" };

const centavos = (v: number | string | null) => (v === null ? null : Math.round(Number(v) * 100));
const numero = (v: number | string | null) => (v === null ? null : Number(v));
const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", dateStyle: "short", timeStyle: "short" }) : "");

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-base font-bold">{titulo}</h2>
      {children}
    </section>
  );
}

export default async function PaginaIntimacao({ params }: PageProps<"/financeiro/intimacoes/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sessao = await exigirSessao();
  const operador = temAcesso(sessao.acesso, "financeiro", "operador");
  const gestor = temAcesso(sessao.acesso, "financeiro", "gestor");
  const supabase = await criarClienteServidor();
  const dados = await lerIntimacao(supabase, id);
  if (!dados) notFound();
  const { intimacao: i, emails, envios, empresas, cartorios, alterarLigado, juntaveis } = dados;
  const editavel = operador && ["identificada", "titulo_localizado", "revisao"].includes(i.status);
  const custas = centavos(i.valor_custas);
  const totalCartorio = centavos(i.valor_total_cartorio);
  const custasDoPortal = i.dados_portal_em ? custas : null;
  const tarefa = tarefaAdiantamento({ cartorio: i.cartorio, valorCustas: numero(i.valor_custas), protocolo: i.protocolo, localizador: i.localizador, numeroTitulo: i.numero_titulo, credorNome: i.credor_nome, codLancamento: i.cod_lancamento }, cartorios);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={ROTA_INTIMACOES} className="text-sm text-muted-foreground hover:underline">← Intimações</Link>
        <Badge variant={i.status === "revisao" ? "destructive" : "default"}>{ROTULO_STATUS[i.status]}</Badge>
        <span className="text-sm text-muted-foreground">
          {i.origem === "cenprot" ? `CENPROT · protocolo ${i.protocolo} de ${formatarData(i.data_protocolo)}` : "4º Ofício"} · {i.cartorio} · recebida em {dataHora(i.criado_em)}
        </span>
      </div>

      {i.motivo && <p className={`rounded-md border p-3 text-sm ${i.status === "revisao" ? "border-destructive text-destructive" : ""}`}>{i.status === "revisao" ? "Revisão: " : "Observação: "}{i.motivo}</p>}
      {i.mesclada_com && <p className="text-sm">Juntada ao apontamento: <Link className="underline" href={`${ROTA_INTIMACOES}/${i.mesclada_com}`}>abrir</Link></p>}

      <Secao titulo="1. Dados da intimação">
        {i.dados_portal_em ? (
          <p className="text-sm">
            Lido do portal do 4º Ofício em {dataHora(i.dados_portal_em)}: prazo <strong>{formatarData(i.data_limite)}</strong>
            {totalCartorio !== null && <> · total a pagar no cartório <strong>{formatarMoeda(totalCartorio)}</strong></>}
            {custasDoPortal !== null && <> · custas <strong>{formatarMoeda(custasDoPortal)}</strong> (calculado: total no cartório − saldo do título; o portal não mostra a composição)</>}.
            {i.dados_informados_em && " Dados conferidos/corrigidos depois por uma pessoa."}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {i.origem === "cenprot" ? "O aviso da CENPROT não traz prazo nem custas: eles chegam com a intimação do 4º Ofício (lida do portal)." : "O portal do cartório não pôde ser lido: informe prazo e custas da intimação."}
          </p>
        )}
        {i.link_intimacao && <p className="text-sm"><a className="underline" href={i.link_intimacao} target="_blank" rel="noopener noreferrer">Abrir a intimação no 4º Ofício</a></p>}
        <FormDados id={i.id} editavel={editavel} empresas={empresas}
          inicial={{ empresaId: i.empresa_id, credorDocumento: i.credor_documento, credorNome: i.credor_nome, numeroTitulo: i.numero_titulo, valorTitulo: numero(i.valor_titulo), vencimentoTitulo: i.vencimento_titulo, dataLimite: i.data_limite, valorCustas: numero(i.valor_custas) }} />
        {operador && i.origem === "cartorio" && i.status === "identificada" && <JuntarAoApontamento id={i.id} opcoes={juntaveis} />}
      </Secao>

      <Secao titulo="2. Título no Contas a Pagar">
        {i.titulo ? (
          <p className="text-sm">Lançamento <strong>{i.titulo.codLancamento}</strong> · documento {i.titulo.numDocumento} · vencimento {formatarData(i.titulo.vencimento)} · {formatarMoeda(i.titulo.valorCentavos)} (saldo {formatarMoeda(i.titulo.saldoCentavos)})</p>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum título escolhido.</p>
        )}
        {operador && ["identificada", "titulo_localizado"].includes(i.status) && <ConsultaTitulos id={i.id} />}
      </Secao>

      <Secao titulo="3. Novo vencimento (aprovação do gestor)">
        {i.nova_data_vencimento && <p className="text-sm">Proposto: <strong>{formatarData(i.nova_data_vencimento)}</strong> por {i.proposto_por_nome} em {dataHora(i.proposto_em)}{i.aprovado_por_nome ? ` · aprovado por ${i.aprovado_por_nome} em ${dataHora(i.aprovado_em)}` : ""}</p>}
        {i.vencimento_alterado_em && <p className="text-sm text-green-700">Vencimento alterado e conferido no Consistem em {dataHora(i.vencimento_alterado_em)}.</p>}
        {operador && i.status === "titulo_localizado" && <BotaoAcao id={i.id} acao="propor" rotulo="Propor o prazo da intimação como novo vencimento" />}
        {i.status === "aguardando_aprovacao" && (gestor ? (
          <div className="flex flex-wrap gap-2">
            {alterarLigado
              ? <AprovarVencimento id={i.id} codLancamento={i.cod_lancamento ?? ""} vencimentoAtual={i.titulo?.vencimento ?? null} novaData={i.nova_data_vencimento ?? ""} valorCentavos={i.titulo?.valorCentavos ?? null} />
              : <p className="text-sm text-amber-700">A alteração no Consistem está desligada (financeiro.intimacoes.alterar_vencimento_no_erp).</p>}
            <AcaoComTexto id={i.id} acao="devolver" variante="outline" rotulo="Devolver" titulo="Devolver a proposta" descricao="A intimação volta para a conferência do título e do prazo." />
          </div>
        ) : <p className="text-sm text-muted-foreground">Aguardando o gestor do Financeiro aprovar.</p>)}
        {envios.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {envios.map((e) => (
              <li key={e.id}>
                {dataHora(e.criado_em)} · {String((e.alteracao as { dataVencimento?: string }).dataVencimento ?? "")} · {e.situacao}{e.ja_estava ? " (já estava assim)" : ""}{e.erro ? ` · ${e.erro}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao titulo="4. Adiantamento das custas ao cartório (lançamento manual)">
        {i.status === "adiantamento_pendente" ? (
          <div className="space-y-3">
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="font-medium">Fornecedor</dt><dd>{tarefa.fornecedorNome}{tarefa.codFornecedor ? ` · código ${tarefa.codFornecedor} no Consistem` : " · código no Consistem não cadastrado (Configurações: financeiro.intimacoes.cartorios)"}</dd>
              <dt className="font-medium">Valor exato</dt><dd>{custas === null ? "—" : formatarMoeda(custas)}</dd>
              <dt className="font-medium">Referência</dt><dd>{tarefa.referencia}</dd>
            </dl>
            <p className="text-sm">{tarefa.instrucao}</p>
            {operador && <AcaoComTexto id={i.id} acao="adiantamento" rotulo="Confirmar que lancei o adiantamento" titulo="Adiantamento lançado no Consistem" descricao={`${tarefa.fornecedorNome} · ${custas === null ? "" : formatarMoeda(custas)}. Esta é a sua confirmação; o Neo Admin não verifica o lançamento.`} />}
          </div>
        ) : i.adiantamento_confirmado_em ? (
          <p className="text-sm">Lançamento manual confirmado por {i.adiantamento_confirmado_por_nome} em {dataHora(i.adiantamento_confirmado_em)}{i.adiantamento_referencia ? ` · referência ${i.adiantamento_referencia}` : " · sem referência informada"}.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Fica disponível depois que o vencimento for alterado no Consistem.</p>
        )}
      </Secao>

      <Secao titulo="5. NF de serviço e consignação">
        {i.nf_numero && <p className="text-sm">NF {i.nf_numero} registrada em {dataHora(i.nf_registrada_em)}.</p>}
        {i.consignacao_em && <p className="text-sm">Consignação confirmada em {dataHora(i.consignacao_em)}{i.consignacao_referencia ? ` · ${i.consignacao_referencia}` : ""}.</p>}
        {operador && i.status === "nf_pendente" && <AcaoComTexto id={i.id} acao="nf" rotulo="Registrar a NF do cartório" titulo="NF de serviço do cartório" descricao="Número da NF emitida pelo cartório pelas custas." />}
        {operador && i.status === "consignacao_pendente" && <AcaoComTexto id={i.id} acao="consignacao" rotulo="Confirmar a consignação" titulo="Consignação do adiantamento" descricao="Abatimento do adiantamento pela NF, feito no Consistem." />}
        {!i.nf_numero && i.status !== "nf_pendente" && <p className="text-sm text-muted-foreground">Etapas do financeiro depois do adiantamento.</p>}
      </Secao>

      {operador && (
        <div className="flex flex-wrap gap-2">
          {i.status === "revisao" && <BotaoAcao id={i.id} acao="retomar" variante="outline" rotulo="Voltar para a conferência" />}
          {["identificada", "titulo_localizado", "revisao"].includes(i.status) && (
            <AcaoComTexto id={i.id} acao="descartar" variante="outline" rotulo="Descartar" titulo="Descartar a intimação" descricao="Use quando não se aplica (ex.: já pago no cartório). Fica registrado com o motivo; nada é apagado." />
          )}
        </div>
      )}

      <Secao titulo="E-mails de origem">
        <ul className="space-y-1 text-sm">
          {emails.map((e) => <li key={e.messageId}>{dataHora(e.recebido_em)} · {e.remetente} → {e.caixa} · {e.assunto}</li>)}
        </ul>
      </Secao>
    </div>
  );
}
