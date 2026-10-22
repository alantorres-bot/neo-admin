// Blocos de tela compartilhados: ações sobre um lançamento, documentos vinculados e histórico (decisões + comentários).
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { data, dataHora } from "@/lib/modulos/fiscal/creditos/formatos";
import { pode, ROTA_CREDITOS, type Papel } from "@/lib/modulos/fiscal/creditos/modulo";
import { corrigirMovimento, decidirMovimento, desvincularDocumento, estornarMovimento } from "./acoes";
import type { Cadastros, Comentario, Decisao, DocumentoVinculado } from "./dados";
import { FormComentario, FormDocumento } from "./formularios";
import { Selo } from "./componentes";
import { Campo, CampoValor, FormularioAcao, TEXTAREA } from "./ui";

export type MovimentoLinha = { id: string; numero: number; tipo: string; status: string; estornado: boolean; registrado_por: string | null };

export function AcoesMovimento({ m, papel, usuarioId, autoaprova = false }: { m: MovimentoLinha; papel: Papel | null; usuarioId: string; autoaprova?: boolean }) {
  if (m.status === "pendente") {
    const proprio = m.registrado_por === usuarioId;
    if (!pode(papel, "validar") || (proprio && !autoaprova)) return <span className="text-[11px] text-muted-foreground">Aguarda aprovação de outro revisor</span>;
    return (
      <div className="flex gap-1">
        <FormularioAcao titulo={`Aprovar lançamento nº ${m.numero}`} botao="Aprovar" tamanho="xs" acao={decidirMovimento} ocultos={{ id: m.id, decisao: "aprovar" }} rotuloSalvar="Aprovar">
          {proprio
            ? <Campo rotulo="Justificativa da autoaprovação *" htmlFor={`ap-${m.id}`}><Input id={`ap-${m.id}`} name="motivo" required minLength={10} maxLength={500} /></Campo>
            : <Campo rotulo="Observação (opcional)" htmlFor={`ap-${m.id}`}><Input id={`ap-${m.id}`} name="motivo" maxLength={500} /></Campo>}
        </FormularioAcao>
        <FormularioAcao titulo={`Rejeitar lançamento nº ${m.numero}`} botao="Rejeitar" tamanho="xs" acao={decidirMovimento} ocultos={{ id: m.id, decisao: "rejeitar" }} rotuloSalvar="Rejeitar">
          <Campo rotulo="Motivo *" htmlFor={`rj-${m.id}`}><textarea id={`rj-${m.id}`} name="motivo" required minLength={10} className={TEXTAREA} /></Campo>
        </FormularioAcao>
      </div>
    );
  }
  if (m.status !== "efetivo" || m.estornado || m.tipo === "estorno" || !pode(papel, "lancar")) return null;
  return (
    <div className="flex gap-1">
      <FormularioAcao titulo={`Estornar lançamento nº ${m.numero}`} botao="Estornar" tamanho="xs" acao={estornarMovimento} ocultos={{ id: m.id }} rotuloSalvar="Estornar"
        descricao="O original fica preservado e marcado como estornado; o estorno entra na mesma competência (que precisa estar aberta).">
        <Campo rotulo="Motivo *" htmlFor={`es-${m.id}`}><textarea id={`es-${m.id}`} name="motivo" required minLength={10} className={TEXTAREA} /></Campo>
      </FormularioAcao>
      {!m.tipo.startsWith("transferencia") && (
        <FormularioAcao titulo={`Corrigir lançamento nº ${m.numero}`} botao="Corrigir" tamanho="xs" acao={corrigirMovimento} ocultos={{ id: m.id }} rotuloSalvar="Corrigir"
          descricao="Estorna o original e registra o lançamento correto ligado a ele. Deixe em branco o que não muda.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Novo valor (R$)" htmlFor="valor"><CampoValor name="valor" /></Campo>
            <Campo rotulo="Nova data" htmlFor={`cd-${m.id}`}><Input id={`cd-${m.id}`} name="data" type="date" /></Campo>
            <Campo rotulo="Nova competência" htmlFor={`cc-${m.id}`}><Input id={`cc-${m.id}`} name="competencia" type="month" /></Campo>
            <Campo rotulo="Protocolo" htmlFor={`cp-${m.id}`}><Input id={`cp-${m.id}`} name="protocolo" /></Campo>
            <Campo rotulo="Nova descrição" htmlFor={`cs-${m.id}`} className="sm:col-span-2"><Input id={`cs-${m.id}`} name="descricao" /></Campo>
            <Campo rotulo="Motivo da correção *" htmlFor={`cm-${m.id}`} className="sm:col-span-2"><textarea id={`cm-${m.id}`} name="motivo" required minLength={10} className={TEXTAREA} /></Campo>
          </div>
        </FormularioAcao>
      )}
    </div>
  );
}

export function DocumentosVinculados({ docs, cad, papel, empresa, alvo, alvoId, tipoPadrao, extra }: {
  docs: DocumentoVinculado[]; cad: Cadastros; papel: Papel | null; empresa: string; alvo: string; alvoId: string; tipoPadrao?: string; extra?: React.ReactNode;
}) {
  const tipo = new Map(cad.tiposDocumento.map((t) => [t.codigo, t.nome]));
  return (
    <div className="space-y-2">
      {pode(papel, "lancar") && <div className="flex flex-wrap gap-2"><FormDocumento cad={cad} empresa={empresa} alvo={alvo} alvoId={alvoId} tipoPadrao={tipoPadrao} />{extra}</div>}
      {docs.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum documento vinculado.</p> : (
        <Table>
          <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Título</TableHead><TableHead>Versão</TableHead><TableHead>Enviado em</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {docs.map((d) => (
              <TableRow key={d.vinculo_id}>
                <TableCell>{tipo.get(d.tipo) ?? d.tipo}</TableCell>
                <TableCell>{d.titulo}{d.ficticio && <Selo className="ml-1">fictício</Selo>}</TableCell>
                <TableCell>v{d.versao}</TableCell>
                <TableCell>{dataHora(d.enviado_em)}</TableCell>
                <TableCell className="space-x-2 whitespace-nowrap">
                  {!d.ficticio && <a className="text-elo hover:underline" href={`${ROTA_CREDITOS}/documentos/${d.documento_id}/baixar`}>Baixar</a>}
                  <a className="text-elo hover:underline" href={`${ROTA_CREDITOS}/documentos?doc=${d.documento_id}`}>Versões</a>
                  {pode(papel, "lancar") && (
                    <FormularioAcao titulo="Remover vínculo" botao="Desvincular" tamanho="xs" variante="ghost" acao={desvincularDocumento} ocultos={{ id: d.vinculo_id }} rotuloSalvar="Remover"
                      descricao="O documento continua no repositório; o vínculo removido fica no histórico.">
                      <Campo rotulo="Motivo *" htmlFor={`dv-${d.vinculo_id}`}><Input id={`dv-${d.vinculo_id}`} name="motivo" required minLength={5} /></Campo>
                    </FormularioAcao>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

const ROTULO_DECISAO: Record<string, string> = {
  cadastro: "Cadastro", edicao: "Edição", "validacao:validado": "Validado", "validacao:rejeitado": "Rejeitado", "validacao:contestado": "Contestado",
  "validacao:em_analise": "Em análise", bloqueio: "Bloqueado", desbloqueio: "Desbloqueado", arquivamento: "Arquivado", estorno: "Estornado", correcao: "Corrigido",
  aprovado: "Aprovado", rejeitado: "Rejeitado", fechamento: "Fechamento", reabertura: "Reabertura", reconciliacao: "Reconciliação",
  aprovada_para_transmissao: "Aprovada para transmissão", conferida: "Entrega conferida", dispensada: "Dispensada", retificada: "Retificada",
};

export function Historico({ decisoes, comentarios, nomeUsuario, alvo, alvoId, papel }: {
  decisoes: Decisao[]; comentarios: Comentario[]; nomeUsuario: Map<string, string>; alvo: string; alvoId: string; papel: Papel | null;
}) {
  const itens = [
    ...decisoes.map((d) => ({ em: d.em, quem: d.usuario_id, texto: `${ROTULO_DECISAO[d.decisao] ?? d.decisao}${d.justificativa ? ` — ${d.justificativa}` : ""}`, tipo: "Decisão" })),
    ...comentarios.map((c) => ({ em: c.criado_em, quem: c.autor_id, texto: c.texto, tipo: "Comentário" })),
  ].sort((a, b) => a.em.localeCompare(b.em));
  return (
    <div className="space-y-2">
      {pode(papel, "lancar") && <FormComentario alvo={alvo} alvoId={alvoId} />}
      {itens.length === 0 ? <p className="text-sm text-muted-foreground">Sem histórico.</p> : (
        <ol className="space-y-1.5 text-sm">
          {itens.map((i, k) => (
            <li key={k} className="border-l-2 border-grade pl-2">
              <span className="text-xs text-muted-foreground">{dataHora(i.em)} · {i.quem ? nomeUsuario.get(i.quem) ?? "usuário" : "sistema"} · {i.tipo}</span>
              <div className="whitespace-pre-wrap">{i.texto}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export const dataCurta = data;
