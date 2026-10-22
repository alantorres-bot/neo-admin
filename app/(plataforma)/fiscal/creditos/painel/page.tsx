import type { Metadata } from "next";
import Link from "next/link";
import { competencia, MESES_CURTOS, reais, centavos } from "@/lib/modulos/fiscal/creditos/formatos";
import { ROTA_CREDITOS, ROTULO_STATUS_OBRIGACAO, type StatusObrigacao } from "@/lib/modulos/fiscal/creditos/modulo";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { Indicador, Secao, Vazio } from "../componentes";
import { comFiltros, contexto, lerCadastros, lerFiltros } from "../dados";
import { BarraFiltros } from "../filtros";
import { GraficoBarras2, GraficoHorizontal, GraficoLinha } from "./graficos";

export const metadata: Metadata = { title: "Dashboard" };

type Painel = {
  creditos: Record<string, number | string>; exercicio: Record<string, number | string>;
  mensal: { competencia: string; saldo: number; gerado: number; utilizado: number }[];
  por_tributo: { codigo: string; saldo: number }[]; anual: { ano: number; saldo: number; disponivel: number }[];
  obrigacoes: Record<string, number> & { por_status: Record<string, number> };
  alertas: Record<string, number>; divergencias: { abertas: number; valor: number }; solicitacoes_documento: number;
};

export default async function PaginaPainel({ searchParams }: PageProps<"/fiscal/creditos/painel">) {
  const { supabase } = await contexto();
  const hoje = hojeEmCuiaba();
  const f = lerFiltros(await searchParams, Number(hoje.slice(0, 4)));
  const cad = await lerCadastros();
  const { data, error } = await supabase.rpc("fis_painel", { p: {
    ano: f.ano, mes: f.mes, empresa_id: f.empresa || null, estabelecimento_id: f.estab || null, tributo_id: f.tributo || null,
    validacao: f.validacao || null, status_obrigacao: f.status || null,
  } });
  if (error) throw new Error(`Painel: ${error.message}`);
  const p = data as Painel;
  const c = (v: number | string | undefined) => centavos(v ?? 0);
  const filtros = { empresa: f.empresa, estab: f.estab, tributo: f.tributo, ano: f.ano };
  const lnk = (rota: string, extra: Record<string, string> = {}) => comFiltros(`${ROTA_CREDITOS}/${rota}`, { ...filtros, ...extra });
  const semDados = Number(p.creditos.quantidade) === 0 && Object.keys(p.obrigacoes.por_status).length === 0;
  const alerta = (r: string) => p.alertas[r] ?? 0;
  const docsPendentes = alerta("R03_SEM_DOCUMENTO") + alerta("R07_DOCUMENTACAO_PENDENTE") + alerta("R05_SEM_RECIBO") + Number(p.solicitacoes_documento ?? 0);
  const ref = String(p.exercicio.referencia ?? "");

  return (
    <div className="space-y-4">
      <BarraFiltros cad={cad} f={f} campos={["ano", "mes", "empresa", "estab", "tributo", "validacao", "status"]} />
      {semDados ? (
        <Vazio titulo="Nenhum crédito ou obrigação para os filtros escolhidos">
          Para começar: em <Link className="text-elo underline" href={`${ROTA_CREDITOS}/configuracoes`}>Configurações</Link> cadastre os estabelecimentos
          e confira os parâmetros das categorias com o contador; depois cadastre os créditos em{" "}
          <Link className="text-elo underline" href={`${ROTA_CREDITOS}/creditos`}>Créditos tributários</Link> (ou importe uma planilha). Os números deste
          painel são sempre calculados a partir do que estiver cadastrado — nada é estimado.
        </Vazio>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador rotulo="Créditos registrados (entradas no razão)" valor={reais(p.creditos.registrado)} detalhe={`${p.creditos.quantidade} crédito(s) ativos`} href={lnk("creditos")} />
            <Indicador rotulo="Registrados em créditos validados" valor={reais(p.creditos.validado)} tom="bom" detalhe="Entradas (saldo inicial, apurado e reconhecido) dos créditos já validados" href={lnk("creditos", { validacao: "validado" })} />
            <Indicador rotulo="Pendentes de validação" valor={reais(p.creditos.pendente_validacao)} tom={c(p.creditos.pendente_validacao) > 0 ? "atencao" : "neutro"} detalhe="Não contam como disponíveis" href={lnk("creditos", { validacao: "pendente" })} />
            <Indicador rotulo="Disponível para utilização" valor={reais(p.creditos.disponivel)} tom="bom" detalhe="Validado, sem bloqueio, no prazo, já descontadas as saídas pendentes" />
            <Indicador rotulo={`Utilizado ${f.mes ? `em ${competencia(ref)}` : `em ${f.ano}`}`} valor={reais(p.exercicio.utilizado_periodo)} />
            <Indicador rotulo={`Compensado ${f.mes ? `em ${competencia(ref)}` : `em ${f.ano}`}`} valor={reais(p.exercicio.compensado_periodo)} />
            <Indicador rotulo={`Ressarcido/restituído/baixado ${f.mes ? `em ${competencia(ref)}` : `em ${f.ano}`}`} valor={reais(p.exercicio.baixado_periodo)} />
            <Indicador rotulo="Registrados em créditos contestados/rejeitados" valor={reais(p.creditos.contestado_rejeitado)} tom={c(p.creditos.contestado_rejeitado) > 0 ? "grave" : "neutro"} />
            <Indicador rotulo={`Saldo inicial do exercício ${f.ano}`} valor={reais(p.exercicio.saldo_inicial)} detalhe="Transportado de dezembro anterior + implantações de janeiro" href={lnk("consolidado")} />
            <Indicador rotulo={`Saldo final (${competencia(ref)})`} valor={reais(p.exercicio.saldo_final)} href={lnk("apuracao")} />
            <Indicador rotulo={`Créditos gerados/reconhecidos em ${f.ano}`} valor={reais(p.exercicio.gerado_ano)} />
            <Indicador rotulo={`Créditos utilizados/compensados em ${f.ano}`} valor={reais(p.exercicio.utilizado_ano)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador rotulo="Obrigações pendentes" valor={p.obrigacoes.pendentes} href={lnk("obrigacoes")} tom={p.obrigacoes.pendentes > 0 ? "atencao" : "neutro"} />
            <Indicador rotulo="Vencem em até 7 dias" valor={p.obrigacoes.proximas} tom={p.obrigacoes.proximas > 0 ? "atencao" : "neutro"} href={lnk("obrigacoes")} />
            <Indicador rotulo="Obrigações atrasadas" valor={p.obrigacoes.atrasadas} tom={p.obrigacoes.atrasadas > 0 ? "grave" : "bom"} href={lnk("obrigacoes", { status: "" })} />
            <Indicador rotulo="Transmitidas aguardando conferência" valor={p.obrigacoes.aguardando_conferencia} tom={p.obrigacoes.aguardando_conferencia > 0 ? "info" : "neutro"} href={lnk("obrigacoes", { status: "transmitida" })} />
            <Indicador rotulo="Vencimentos a confirmar" valor={p.obrigacoes.vencimento_a_confirmar} tom={p.obrigacoes.vencimento_a_confirmar > 0 ? "atencao" : "neutro"} detalhe="Sem regra validada pelo contador" />
            <Indicador rotulo="Documentos ou comprovantes pendentes" valor={docsPendentes} tom={docsPendentes > 0 ? "atencao" : "bom"} href={`${ROTA_CREDITOS}/documentos?faltantes=1`} detalhe="Sem documento, exigidos, recibos e solicitações" />
            <Indicador rotulo="Divergências abertas" valor={p.divergencias.abertas} detalhe={`Diferenças somadas: ${reais(p.divergencias.valor)}`} tom={p.divergencias.abertas > 0 ? "grave" : "bom"} href={`${ROTA_CREDITOS}/conciliacao`} />
            <Indicador rotulo="Lançamentos aguardando aprovação" valor={p.creditos.pendentes_aprovacao} tom={Number(p.creditos.pendentes_aprovacao) > 0 ? "atencao" : "neutro"} href={`${ROTA_CREDITOS}/tarefas`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Secao titulo={`Evolução mensal do saldo de créditos (${f.ano})`}>
              <GraficoLinha titulo="Saldo final por mês" pontos={p.mensal.map((m) => ({ rotulo: MESES_CURTOS[Number(m.competencia.slice(5, 7)) - 1], valor: c(m.saldo) }))} />
            </Secao>
            <Secao titulo={`Créditos gerados × utilizados por mês (${f.ano})`} descricao="Gerados: apurados, reconhecidos, ajustes positivos e transferências recebidas. Utilizados: deduções, compensações, baixas, ajustes negativos e transferências enviadas.">
              <GraficoBarras2 titulo="Gerados e utilizados por mês" series={["Gerados", "Utilizados"]}
                pontos={p.mensal.map((m) => ({ rotulo: MESES_CURTOS[Number(m.competencia.slice(5, 7)) - 1], valores: [c(m.gerado), c(m.utilizado)] }))} />
            </Secao>
            <Secao titulo={`Distribuição do saldo por tributo (${competencia(ref)})`}>
              {p.por_tributo.length === 0 ? <p className="text-sm text-muted-foreground">Sem saldo na competência.</p>
                : <GraficoHorizontal titulo="Saldo por tributo" itens={p.por_tributo.map((t) => ({ rotulo: t.codigo, valor: c(t.saldo) }))} />}
            </Secao>
            <Secao titulo="Evolução anual do saldo" descricao="Saldo em dezembro de cada ano (no ano corrente, o mês de referência); 'validado' considera a situação atual de validação.">
              <GraficoBarras2 titulo="Saldo anual e saldo validado" series={["Saldo registrado", "Saldo de créditos validados"]}
                pontos={p.anual.map((a) => ({ rotulo: String(a.ano), valores: [c(a.saldo), c(a.disponivel)] }))} />
            </Secao>
            <Secao titulo={`Situação das obrigações fiscais (${f.mes ? competencia(ref) : f.ano})`}>
              {Object.keys(p.obrigacoes.por_status).length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma obrigação no período.</p>
                : <GraficoHorizontal titulo="Obrigações por situação" formato="quantidade"
                    itens={Object.entries(p.obrigacoes.por_status).map(([s, n]) => ({ rotulo: ROTULO_STATUS_OBRIGACAO[s as StatusObrigacao] ?? s, valor: n }))} />}
            </Secao>
          </div>
        </>
      )}
    </div>
  );
}
