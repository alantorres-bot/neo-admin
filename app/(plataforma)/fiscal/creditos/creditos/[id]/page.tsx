import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { linhaDoBanco, type LinhaBanco } from "@/lib/modulos/fiscal/creditos/apuracao";
import { competencia, data, moeda, reais } from "@/lib/modulos/fiscal/creditos/formatos";
import {
  pode, ROTA_CREDITOS, ROTULO_CLASSE, ROTULO_DISPONIBILIDADE, ROTULO_FORMA, ROTULO_STATUS_MOV, ROTULO_VALIDACAO, type Disponibilidade, type Validacao,
} from "@/lib/modulos/fiscal/creditos/modulo";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { arquivarCredito, atualizarCredito, bloquearCredito, transferir, validarCredito } from "../../acoes";
import { AcoesMovimento, DocumentosVinculados, Historico } from "../../blocos";
import { Indicador, Secao, Selo, tomDisponibilidade, tomValidacao } from "../../componentes";
import { contexto, lerCadastros, lerHistorico, nomes } from "../../dados";
import { FormMovimento, FormTarefa } from "../../formularios";
import { Campo, CampoValor, FormularioAcao, SELECT, TEXTAREA } from "../../ui";

export const metadata: Metadata = { title: "Crédito" };

export default async function PaginaCredito({ params }: PageProps<"/fiscal/creditos/creditos/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, papel, sessao, autoaprova } = await contexto();
  const [{ data: c }, cad] = await Promise.all([supabase.from("fis_creditos_saldos").select("*").eq("id", id).maybeSingle(), lerCadastros()]);
  if (!c) notFound();
  const hoje = hojeEmCuiaba();
  const [{ data: movs }, { data: ap }, hist, { data: outros }, { data: tarefas }, { data: bruto }] = await Promise.all([
    supabase.from("fis_movimentos").select("id, numero, tipo, classe, natureza, valor, valor_assinado, data, competencia, descricao, documento_ref, protocolo, processo, estorno_de, corrige_id, transferencia_id, status, estornado, registrado_por, registrado_em, aprovado_por, decisao_motivo")
      .eq("credito_id", id).order("competencia").order("numero"),
    supabase.rpc("fis_apuracao", { p_inicio: c.competencia_origem, p_fim: `${hoje.slice(0, 7)}-01`, p_estabelecimento: c.estabelecimento_id, p_tributo: c.tributo_id }),
    lerHistorico(supabase, "credito", id),
    supabase.from("fis_creditos").select("id, codigo, descricao").eq("arquivado", false).neq("id", id).order("codigo").limit(500),
    supabase.from("fis_tarefas").select("id, titulo, status, responsavel_id, prazo").eq("alvo", "credito").eq("alvo_id", id).order("criado_em"),
    supabase.from("fis_creditos").select("responsavel_lancamento, arquivado_motivo, validacao_justificativa").eq("id", id).maybeSingle(),
  ]);
  const n = nomes(cad);
  const cat = cad.categorias.find((x) => x.id === c.categoria_id);
  const linhas = ((ap ?? []) as LinhaBanco[]).filter((l) => l.credito_id === id).map(linhaDoBanco);
  const numeroDe = new Map((movs ?? []).map((m) => [m.id, m.numero]));
  const lancou = bruto?.responsavel_lancamento as string | null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`${ROTA_CREDITOS}/creditos`} className="text-elo hover:underline">← Créditos</Link>
        <h2 className="font-condensada text-xl font-bold">{c.codigo}</h2>
        <Selo tom={tomValidacao(c.validacao)}>{ROTULO_VALIDACAO[c.validacao as Validacao]}</Selo>
        <Selo tom={tomDisponibilidade(c.disponibilidade)}>{ROTULO_DISPONIBILIDADE[c.disponibilidade as Disponibilidade]}</Selo>
        {c.ficticio && <Selo>Dado fictício (demonstração)</Selo>}
      </div>
      <p className="text-sm">{c.descricao}</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador rotulo="Valor original" valor={reais(c.valor_original)} detalhe={c.valor_reconhecido !== null ? `Reconhecido: ${reais(c.valor_reconhecido)}` : "Ainda não reconhecido"} />
        <Indicador rotulo="Utilizado / compensado" valor={reais(Number(c.utilizado) + Number(c.compensado))} detalhe={`Ressarcido/baixado: ${reais(c.baixado)}`} />
        <Indicador rotulo="Saldo remanescente (razão)" valor={reais(c.saldo)} detalhe={`Ajustes líquidos: ${reais(c.ajustes)} · Transferências: ${reais(c.transferido)}`} />
        <Indicador rotulo="Disponível para utilização" valor={reais(c.saldo_disponivel)} tom={Number(c.saldo_disponivel) > 0 ? "bom" : "neutro"}
          detalhe={Number(c.pendente_saida) > 0 ? `Reservado por saídas pendentes: ${reais(c.pendente_saida)}` : "Segundo os critérios cadastrados"} />
      </div>

      <div className="flex flex-wrap gap-2">
        {pode(papel, "lancar") && !c.arquivado && <FormMovimento cad={cad} creditoId={id} />}
        {pode(papel, "validar") && !c.arquivado && (lancou === sessao.userId && !autoaprova
          ?<span className="self-center text-xs text-muted-foreground">Validação: outra pessoa precisa validar (você lançou este crédito).</span>
          : (
          <FormularioAcao titulo="Validar crédito" botao="Validar / decidir" acao={validarCredito} ocultos={{ id }} rotuloSalvar="Registrar decisão"
            descricao="Validar exige os documentos exigidos pela categoria vinculados. Reconhecimento parcial gera ajuste negativo (glosa) no razão.">
            <Campo rotulo="Decisão *" htmlFor="vd-dec">
              <select id="vd-dec" name="decisao" className={SELECT} defaultValue="validado">
                <option value="validado">Validar</option><option value="em_analise">Em análise</option><option value="contestado">Contestado</option><option value="rejeitado">Rejeitar</option>
              </select>
            </Campo>
            <Campo rotulo="Valor reconhecido (R$)" htmlFor="valor_reconhecido" dica={`Vazio: ${reais(c.valor_reconhecido ?? c.valor_original)}`}><CampoValor name="valor_reconhecido" permitirZero /></Campo>
            {lancou === sessao.userId
              ? <Campo rotulo="Justificativa da autoaprovação *" htmlFor="vd-just" dica="Você lançou este crédito: a justificativa é obrigatória (mínimo 10 caracteres)."><textarea id="vd-just" name="justificativa" required minLength={10} className={TEXTAREA} /></Campo>
              : <Campo rotulo="Justificativa" htmlFor="vd-just" dica="Obrigatória para rejeitar, contestar ou reconhecer parcialmente."><textarea id="vd-just" name="justificativa" className={TEXTAREA} /></Campo>}
          </FormularioAcao>
        ))}
        {pode(papel, "lancar") && !c.arquivado && (
          <FormularioAcao titulo="Editar crédito" botao="Editar" acao={atualizarCredito} ocultos={{ id }} rotuloSalvar="Salvar"
            descricao="Valor e competência não são editados: lançamento errado é arquivado (com estorno) e recadastrado. Categoria e origem só antes da validação.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Descrição" htmlFor="ed-desc" className="sm:col-span-2"><Input id="ed-desc" name="descricao" defaultValue={c.descricao} /></Campo>
              <Campo rotulo="Número do processo" htmlFor="ed-proc"><Input id="ed-proc" name="numero_processo" defaultValue={c.numero_processo ?? ""} /></Campo>
              <Campo rotulo="Documento comprobatório" htmlFor="ed-doc"><Input id="ed-doc" name="documento_ref" defaultValue={c.documento_ref ?? ""} /></Campo>
              <Campo rotulo="Data de reconhecimento" htmlFor="ed-rec"><Input id="ed-rec" name="data_reconhecimento" type="date" defaultValue={c.data_reconhecimento ?? ""} /></Campo>
              <Campo rotulo="Responsável" htmlFor="ed-resp">
                <select id="ed-resp" name="responsavel_id" className={SELECT} defaultValue={c.responsavel_id ?? ""}><option value="">—</option>{cad.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select>
              </Campo>
              {c.validacao !== "validado" && (
                <Campo rotulo="Categoria" htmlFor="ed-cat">
                  <select id="ed-cat" name="categoria_id" className={SELECT} defaultValue={c.categoria_id}>{cad.categorias.filter((x) => x.ativo).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}</select>
                </Campo>
              )}
              {pode(papel, "validar") && (
                <Campo rotulo="Prazo de aproveitamento" htmlFor="ed-lim" dica="Só revisor/contador/admin altera.">
                  <Input id="ed-lim" name="data_limite_aproveitamento" type="date" defaultValue={c.data_limite_aproveitamento ?? ""} />
                </Campo>
              )}
              <Campo rotulo="Observações" htmlFor="ed-obs" className="sm:col-span-2"><textarea id="ed-obs" name="observacoes" className={TEXTAREA} defaultValue={c.observacoes ?? ""} /></Campo>
            </div>
          </FormularioAcao>
        )}
        {pode(papel, "lancar") && !c.arquivado && (cat?.formas_utilizacao ?? []).includes("transferencia") && (
          <FormularioAcao titulo="Transferência autorizada" botao="Transferir saldo" acao={transferir} ocultos={{ origem_id: id }} rotuloSalvar="Registrar"
            descricao="Nunca automática: exige fundamento/autorização e aprovação de um revisor (outra pessoa).">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Crédito de destino *" htmlFor="tr-dest" className="sm:col-span-2">
                <select id="tr-dest" name="destino_id" required className={SELECT} defaultValue=""><option value="" disabled>Escolha…</option>{(outros ?? []).map((o) => <option key={o.id} value={o.id}>{o.codigo} — {o.descricao.slice(0, 60)}</option>)}</select>
              </Campo>
              <Campo rotulo="Valor (R$) *" htmlFor="valor"><CampoValor name="valor" required /></Campo>
              <Campo rotulo="Competência *" htmlFor="tr-comp"><Input id="tr-comp" name="competencia" type="month" required /></Campo>
              <Campo rotulo="Data *" htmlFor="tr-data"><Input id="tr-data" name="data" type="date" required /></Campo>
              <Campo rotulo="Protocolo" htmlFor="tr-prot"><Input id="tr-prot" name="protocolo" /></Campo>
              <Campo rotulo="Fundamento e autorização *" htmlFor="tr-fund" className="sm:col-span-2"><textarea id="tr-fund" name="fundamento" required minLength={15} className={TEXTAREA} /></Campo>
            </div>
          </FormularioAcao>
        )}
        {pode(papel, "validar") && !c.arquivado && (
          <FormularioAcao titulo={c.bloqueado ? "Desbloquear crédito" : "Bloquear crédito"} botao={c.bloqueado ? "Desbloquear" : "Bloquear"} acao={bloquearCredito}
            ocultos={{ id, bloquear: c.bloqueado ? "nao" : "sim" }} rotuloSalvar="Confirmar" descricao="Crédito bloqueado não pode ser utilizado, compensado nem transferido.">
            <Campo rotulo="Motivo *" htmlFor="bl-mot"><textarea id="bl-mot" name="motivo" required minLength={10} className={TEXTAREA} /></Campo>
          </FormularioAcao>
        )}
        {pode(papel, "lancar") && <FormTarefa cad={cad} empresa={c.empresa_id} alvo="credito" alvoId={id} botao="Solicitar documento / tarefa" tipoPadrao="solicitacao_documento" tituloPadrao={`Documento do crédito ${c.codigo}`} />}
        {pode(papel, "lancar") && !c.arquivado && (
          <FormularioAcao titulo="Arquivar crédito" botao="Arquivar" variante="ghost" acao={arquivarCredito} ocultos={{ id }} rotuloSalvar="Arquivar"
            descricao="Arquivamento lógico: nada é apagado. Com saldo, só como lançamento indevido (estorna as entradas; exige não haver utilizações).">
            <Campo rotulo="Motivo *" htmlFor="ar-mot"><textarea id="ar-mot" name="motivo" required minLength={10} className={TEXTAREA} /></Campo>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="estornar" /> Lançamento indevido: estornar as entradas</label>
          </FormularioAcao>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Secao titulo="Dados do crédito">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Empresa</dt><dd>{n.empresa.get(c.empresa_id)}</dd>
            <dt className="text-muted-foreground">Estabelecimento</dt><dd>{n.estab.get(c.estabelecimento_id)}</dd>
            <dt className="text-muted-foreground">Tributo</dt><dd>{n.tributo.get(c.tributo_id)}</dd>
            <dt className="text-muted-foreground">Categoria</dt><dd>{cat?.nome} {cat && !cat.regra_validada && <Selo tom="atencao">parâmetros não validados</Selo>}</dd>
            <dt className="text-muted-foreground">Formas permitidas</dt><dd>{(cat?.formas_utilizacao ?? []).map((f) => ROTULO_FORMA[f] ?? f).join(", ") || "nenhuma (parametrizar)"}</dd>
            <dt className="text-muted-foreground">Origem</dt><dd>{n.origem.get(c.origem) ?? c.origem}</dd>
            <dt className="text-muted-foreground">Competência de origem</dt><dd>{competencia(c.competencia_origem)}</dd>
            <dt className="text-muted-foreground">Reconhecimento</dt><dd>{data(c.data_reconhecimento) || "—"}</dd>
            <dt className="text-muted-foreground">Processo</dt><dd>{c.numero_processo ?? "—"}</dd>
            <dt className="text-muted-foreground">Documento</dt><dd>{c.documento_ref ?? "—"}</dd>
            <dt className="text-muted-foreground">Prazo de aproveitamento</dt><dd>{c.data_limite_aproveitamento ? data(c.data_limite_aproveitamento) : "não parametrizado"}</dd>
            <dt className="text-muted-foreground">Lançado por</dt><dd>{lancou ? n.usuario.get(lancou) : "sistema"}</dd>
            <dt className="text-muted-foreground">Responsável</dt><dd>{c.responsavel_id ? n.usuario.get(c.responsavel_id) : "—"}</dd>
            <dt className="text-muted-foreground">Validação</dt><dd>{c.validado_por ? `${n.usuario.get(c.validado_por) ?? "—"} em ${data(String(c.validado_em ?? "").slice(0, 10))}` : "—"}{bruto?.validacao_justificativa ? ` — ${bruto.validacao_justificativa}` : ""}</dd>
            {c.bloqueado && <><dt className="text-muted-foreground">Bloqueio</dt><dd>{c.bloqueio_motivo}</dd></>}
            {c.arquivado && <><dt className="text-muted-foreground">Arquivamento</dt><dd>{bruto?.arquivado_motivo}</dd></>}
            <dt className="text-muted-foreground">Observações</dt><dd className="whitespace-pre-wrap">{c.observacoes ?? "—"}</dd>
          </dl>
        </Secao>
        <Secao titulo="Documentos" descricao={cat?.documentos_exigidos.length ? `Exigidos pela categoria: ${cat.documentos_exigidos.map((d) => n.tipoDoc.get(d) ?? d).join(", ")}` : undefined}>
          <DocumentosVinculados docs={hist.documentos} cad={cad} papel={papel} empresa={c.empresa_id} alvo="credito" alvoId={id} tipoPadrao={cat?.documentos_exigidos[0]} />
        </Secao>
        <Secao titulo="Histórico de decisões e comentários">
          <Historico decisoes={hist.decisoes} comentarios={hist.comentarios} nomeUsuario={n.usuario} alvo="credito" alvoId={id} papel={papel} />
          {(tarefas ?? []).length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {(tarefas ?? []).map((t) => <li key={t.id}><Link className="text-elo hover:underline" href={`${ROTA_CREDITOS}/tarefas?tarefa=${t.id}`}>{t.titulo}</Link> · {t.status}{t.prazo ? ` · prazo ${data(t.prazo)}` : ""}</li>)}
            </ul>
          )}
        </Secao>
      </div>

      <Secao titulo="Saldo por competência (transporte mês a mês)" descricao="Saldo inicial de cada mês = saldo final do mês anterior deste mesmo crédito.">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Competência</TableHead><TableHead className="text-right">Saldo inicial</TableHead><TableHead className="text-right">Gerado</TableHead><TableHead className="text-right">Reconhecido</TableHead>
            <TableHead className="text-right">Ajustes (+)</TableHead><TableHead className="text-right">Ajustes (−)</TableHead><TableHead className="text-right">Utilizado</TableHead>
            <TableHead className="text-right">Compensado</TableHead><TableHead className="text-right">Baixado</TableHead><TableHead className="text-right">Transf. líquida</TableHead><TableHead className="text-right">Saldo final</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={l.competencia}>
                <TableCell>{competencia(l.competencia)}{l.pendentes > 0 && <span className="ml-1 text-[11px] text-amber-700">{l.pendentes} pend.</span>}</TableCell>
                <TableCell className="text-right tabular-nums">{moeda(l.saldoInicial)}</TableCell><TableCell className="text-right tabular-nums">{moeda(l.gerado)}</TableCell>
                <TableCell className="text-right tabular-nums">{moeda(l.reconhecido)}</TableCell><TableCell className="text-right tabular-nums">{moeda(l.ajustesPositivos)}</TableCell>
                <TableCell className="text-right tabular-nums">{moeda(l.ajustesNegativos)}</TableCell><TableCell className="text-right tabular-nums">{moeda(l.utilizado)}</TableCell>
                <TableCell className="text-right tabular-nums">{moeda(l.compensado)}</TableCell><TableCell className="text-right tabular-nums">{moeda(l.baixado)}</TableCell>
                <TableCell className="text-right tabular-nums">{moeda(l.transferidoEntrada - l.transferidoSaida)}</TableCell><TableCell className="text-right font-medium tabular-nums">{moeda(l.saldoFinal)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Secao>

      <Secao titulo="Razão de movimentações (imutável)" descricao="Correções são feitas por estorno e novo lançamento ligado ao original.">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Nº</TableHead><TableHead>Competência</TableHead><TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Valor</TableHead>
            <TableHead>Descrição</TableHead><TableHead>Protocolo</TableHead><TableHead>Situação</TableHead><TableHead>Registrado por</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(movs ?? []).map((m) => (
              <TableRow key={m.id} className={m.estornado || m.status === "rejeitado" ? "text-muted-foreground line-through decoration-1" : ""}>
                <TableCell>{m.numero}</TableCell>
                <TableCell>{competencia(m.competencia)}</TableCell>
                <TableCell>{data(m.data)}</TableCell>
                <TableCell>{n.tipoMov.get(m.tipo) ?? m.tipo}{m.tipo === "estorno" && <span className="text-xs"> de nº {numeroDe.get(m.estorno_de)} ({ROTULO_CLASSE[m.classe]})</span>}{m.corrige_id && <span className="text-xs"> corrige nº {numeroDe.get(m.corrige_id)}</span>}</TableCell>
                <TableCell className={`text-right tabular-nums ${Number(m.valor_assinado) < 0 ? "text-red-700 dark:text-red-400" : ""}`}>{reais(m.valor_assinado)}</TableCell>
                <TableCell className="max-w-72 truncate" title={m.descricao}>{m.descricao}</TableCell>
                <TableCell>{m.protocolo ?? (m.tipo === "compensacao" ? <Selo tom="atencao">sem protocolo</Selo> : "—")}</TableCell>
                <TableCell>{m.estornado ? "Estornado" : ROTULO_STATUS_MOV[m.status]}{m.decisao_motivo ? <span className="block text-[11px]">{m.decisao_motivo}</span> : null}</TableCell>
                <TableCell>{m.registrado_por ? n.usuario.get(m.registrado_por) : "sistema"}</TableCell>
                <TableCell><AcoesMovimento m={m} papel={papel} usuarioId={sessao.userId} autoaprova={autoaprova} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Secao>
    </div>
  );
}
