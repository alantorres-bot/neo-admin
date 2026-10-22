import type { Metadata } from "next";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { competencia, dataHora } from "@/lib/modulos/fiscal/creditos/formatos";
import { pode, REGRAS, ROTA_CREDITOS } from "@/lib/modulos/fiscal/creditos/modulo";
import { sanitizarBusca } from "@/lib/nucleo/erros";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { arquivarDocumento, vincularDocumento } from "../acoes";
import { Paginacao, Secao, Selo, Vazio } from "../componentes";
import { comFiltros, contexto, lerCadastros, lerFiltros, nomes } from "../dados";
import { BarraFiltros } from "../filtros";
import { FormDocumento } from "../formularios";
import { Campo, FormularioAcao, SELECT, TEXTAREA } from "../ui";

export const metadata: Metadata = { title: "Documentos" };
const POR_PAGINA = 40;

type Doc = {
  id: string; tipo: string; titulo: string; empresa_id: string; estabelecimento_id: string | null; tributo_id: string | null; competencia: string | null; nome_arquivo: string | null;
  tamanho_bytes: number | null; versao: number; raiz_id: string | null; substitui_id: string | null; motivo_substituicao: string | null; situacao: string; ficticio: boolean;
  enviado_por: string | null; enviado_em: string; observacoes: string | null; arquivo_path: string | null;
};
const COLS = "id, tipo, titulo, empresa_id, estabelecimento_id, tributo_id, competencia, nome_arquivo, tamanho_bytes, versao, raiz_id, substitui_id, motivo_substituicao, situacao, ficticio, enviado_por, enviado_em, observacoes, arquivo_path";

export default async function PaginaDocumentos({ searchParams }: PageProps<"/fiscal/creditos/documentos">) {
  const { supabase, papel } = await contexto();
  const sp = await searchParams;
  const f = lerFiltros(sp, Number(hojeEmCuiaba().slice(0, 4)));
  const tipo = typeof sp.tipo === "string" ? sp.tipo : "";
  const situacao = typeof sp.situacao === "string" ? sp.situacao : "vigente";
  const docSel = typeof sp.doc === "string" && /^[0-9a-f-]{36}$/i.test(sp.doc) ? sp.doc : "";
  const faltantes = sp.faltantes === "1";
  const cad = await lerCadastros();
  const n = nomes(cad);
  const comAno = typeof sp.ano === "string";

  let q = supabase.from("fis_documentos").select(COLS, { count: "exact" }).order("enviado_em", { ascending: false }).range((f.pagina - 1) * POR_PAGINA, f.pagina * POR_PAGINA - 1);
  if (situacao !== "todos") q = q.eq("situacao", situacao);
  if (tipo) q = q.eq("tipo", tipo);
  if (f.empresa) q = q.eq("empresa_id", f.empresa);
  if (f.estab) q = q.eq("estabelecimento_id", f.estab);
  if (f.tributo) q = q.eq("tributo_id", f.tributo);
  if (comAno) q = f.mes ? q.eq("competencia", `${f.ano}-${String(f.mes).padStart(2, "0")}-01`) : q.gte("competencia", `${f.ano}-01-01`).lte("competencia", `${f.ano}-12-01`);
  const busca = sanitizarBusca(f.busca);
  if (busca) q = q.or(`titulo.ilike.%${busca}%,nome_arquivo.ilike.%${busca}%,observacoes.ilike.%${busca}%`);
  const [{ data: docs, count, error }, sel, falt, { data: solicitacoes }] = await Promise.all([
    q,
    docSel ? supabase.from("fis_documentos").select(COLS).eq("id", docSel).maybeSingle() : Promise.resolve({ data: null }),
    faltantes ? supabase.rpc("fis_verificar", { p_empresa: f.empresa || null, p_ano: null }) : Promise.resolve({ data: [] }),
    faltantes ? supabase.from("fis_tarefas").select("id, titulo, tipo_documento_solicitado, responsavel_id, prazo, alvo, alvo_id").eq("tipo", "solicitacao_documento").in("status", ["aberta", "em_andamento"]) : Promise.resolve({ data: [] }),
  ]);
  if (error) throw new Error(`Documentos: ${error.message}`);
  const selecionado = sel.data as Doc | null;
  const versoes = selecionado
    ? ((await supabase.from("fis_documentos").select(COLS).or(`id.eq.${selecionado.raiz_id ?? selecionado.id},raiz_id.eq.${selecionado.raiz_id ?? selecionado.id}`).order("versao")).data ?? []) as Doc[]
    : [];
  const vinculos = selecionado ? ((await supabase.from("fis_documentos_vinculos").select("id, alvo, alvo_id, criado_em, removido_em, removido_motivo").eq("documento_id", selecionado.id)).data ?? []) : [];
  const listaFaltantes = ((falt.data ?? []) as { regra: string; descricao: string; credito_id: string | null; obrigacao_id: string | null; chave: string }[])
    .filter((a) => ["R03_SEM_DOCUMENTO", "R05_SEM_RECIBO", "R07_DOCUMENTACAO_PENDENTE", "R06_COMPENSACAO_SEM_PROTOCOLO"].includes(a.regra));
  const base = { empresa: f.empresa, estab: f.estab, tributo: f.tributo, busca: f.busca, tipo, situacao, ...(comAno ? { ano: f.ano, mes: f.mes } : {}) };
  const linkAlvo = (alvo: string, id: string) => alvo === "credito" ? `${ROTA_CREDITOS}/creditos/${id}` : alvo === "obrigacao" ? `${ROTA_CREDITOS}/obrigacoes/${id}` : alvo === "divergencia" ? `${ROTA_CREDITOS}/conciliacao` : alvo === "tarefa" ? `${ROTA_CREDITOS}/tarefas?tarefa=${id}` : `${ROTA_CREDITOS}/movimentos`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={`${ROTA_CREDITOS}/documentos`} className={`rounded-[3px] border px-2 py-0.5 ${!faltantes ? "border-marca bg-marca-clara font-bold" : ""}`}>Repositório</Link>
        <Link href={`${ROTA_CREDITOS}/documentos?faltantes=1`} className={`rounded-[3px] border px-2 py-0.5 ${faltantes ? "border-marca bg-marca-clara font-bold" : ""}`}>Documentos faltantes</Link>
      </div>
      {faltantes ? (
        <Secao titulo="Documentos e comprovantes faltantes" descricao="Pelas regras da conciliação e pelas solicitações abertas.">
          {listaFaltantes.length === 0 && (solicitacoes ?? []).length === 0 ? <Vazio titulo="Nada pendente" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Regra</TableHead><TableHead>O que falta</TableHead><TableHead>Registro</TableHead></TableRow></TableHeader>
              <TableBody>
                {listaFaltantes.map((a) => (
                  <TableRow key={a.chave}>
                    <TableCell>{REGRAS[a.regra]?.nome ?? a.regra}</TableCell><TableCell>{a.descricao}</TableCell>
                    <TableCell>{a.credito_id ? <Link className="text-elo hover:underline" href={`${ROTA_CREDITOS}/creditos/${a.credito_id}`}>abrir crédito</Link> : a.obrigacao_id ? <Link className="text-elo hover:underline" href={`${ROTA_CREDITOS}/obrigacoes/${a.obrigacao_id}`}>abrir obrigação</Link> : "—"}</TableCell>
                  </TableRow>
                ))}
                {(solicitacoes ?? []).map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>Solicitação aberta</TableCell><TableCell>{t.titulo} ({n.tipoDoc.get(t.tipo_documento_solicitado ?? "") ?? "documento"}){t.responsavel_id ? ` · ${n.usuario.get(t.responsavel_id)}` : ""}</TableCell>
                    <TableCell><Link className="text-elo hover:underline" href={`${ROTA_CREDITOS}/tarefas?tarefa=${t.id}`}>abrir tarefa</Link></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Secao>
      ) : (
        <Secao titulo="Repositório de documentos fiscais" descricao="Privado: download só por link temporário para quem tem acesso à empresa. Documento salvo NÃO significa transmitido a órgão público."
          acoes={pode(papel, "lancar") ? <FormDocumento cad={cad} /> : undefined}>
          <BarraFiltros cad={cad} f={f} campos={["ano", "mes", "empresa", "estab", "tributo", "busca"]} />
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <form method="get" className="flex flex-wrap items-end gap-2">
              {Object.entries(base).filter(([k, v]) => v && k !== "tipo" && k !== "situacao").map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
              <label className="grid gap-0.5"><span className="text-muted-foreground">Tipo documental</span>
                <select name="tipo" defaultValue={tipo} className={SELECT}><option value="">Todos</option>{cad.tiposDocumento.map((t) => <option key={t.codigo} value={t.codigo}>{t.nome}</option>)}</select></label>
              <label className="grid gap-0.5"><span className="text-muted-foreground">Situação</span>
                <select name="situacao" defaultValue={situacao} className={SELECT}><option value="vigente">Vigentes</option><option value="substituido">Substituídos (versões anteriores)</option><option value="arquivado">Arquivados</option><option value="todos">Todos</option></select></label>
              <button type="submit" className="h-9 rounded-[3px] border px-2">Filtrar</button>
            </form>
          </div>
          {(docs ?? []).length === 0 ? <div className="mt-3"><Vazio titulo="Nenhum documento">Anexe documentos pelo botão acima ou direto no crédito, na obrigação ou na competência.</Vazio></div> : (
            <div className="mt-3">
              <Table>
                <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Título</TableHead><TableHead>Competência</TableHead><TableHead>Tributo</TableHead><TableHead>Estabelecimento</TableHead><TableHead>Versão</TableHead><TableHead>Situação</TableHead><TableHead>Enviado</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {((docs ?? []) as Doc[]).map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>{n.tipoDoc.get(d.tipo) ?? d.tipo}</TableCell>
                      <TableCell><Link className="text-elo hover:underline" href={comFiltros(`${ROTA_CREDITOS}/documentos`, base, { doc: d.id })}>{d.titulo}</Link>{d.ficticio && <span className="ml-1 text-[10px] text-muted-foreground">(fictício)</span>}</TableCell>
                      <TableCell>{competencia(d.competencia) || "—"}</TableCell>
                      <TableCell>{d.tributo_id ? n.tributo.get(d.tributo_id) : "—"}</TableCell>
                      <TableCell>{d.estabelecimento_id ? n.estab.get(d.estabelecimento_id) : "—"}</TableCell>
                      <TableCell>v{d.versao}</TableCell>
                      <TableCell><Selo tom={d.situacao === "vigente" ? "bom" : "neutro"}>{d.situacao}</Selo></TableCell>
                      <TableCell className="text-xs">{d.enviado_por ? n.usuario.get(d.enviado_por) : "sistema"}<br />{dataHora(d.enviado_em)}</TableCell>
                      <TableCell>{d.arquivo_path ? <a className="text-elo hover:underline" href={`${ROTA_CREDITOS}/documentos/${d.id}/baixar`}>Baixar</a> : <span className="text-xs text-muted-foreground">sem arquivo</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Paginacao pagina={f.pagina} total={count ?? 0} porPagina={POR_PAGINA} href={(p) => comFiltros(`${ROTA_CREDITOS}/documentos`, base, { pagina: p })} />
            </div>
          )}
        </Secao>
      )}

      {selecionado && (
        <Secao titulo={`Documento: ${selecionado.titulo}`} descricao={`${n.tipoDoc.get(selecionado.tipo)} · ${n.empresa.get(selecionado.empresa_id)} · ${selecionado.nome_arquivo ?? "sem arquivo"}${selecionado.tamanho_bytes ? ` · ${(selecionado.tamanho_bytes / 1024).toFixed(0)} KB` : ""}`}
          acoes={<>
            {pode(papel, "lancar") && selecionado.situacao === "vigente" && <FormDocumento cad={cad} empresa={selecionado.empresa_id} substitui={{ id: selecionado.id, titulo: selecionado.titulo }} botao="Enviar nova versão" />}
            {pode(papel, "lancar") && selecionado.situacao === "vigente" && (
              <FormularioAcao titulo="Vincular a um registro" botao="Vincular" acao={vincularDocumento} ocultos={{ documento_id: selecionado.id }} rotuloSalvar="Vincular"
                descricao="Cole o identificador (da URL) do crédito, obrigação, movimentação, competência ou divergência.">
                <Campo rotulo="Tipo de registro" htmlFor="vc-alvo">
                  <select id="vc-alvo" name="alvo" className={SELECT}><option value="credito">Crédito</option><option value="obrigacao">Obrigação</option><option value="movimento">Movimentação</option><option value="periodo">Competência</option><option value="divergencia">Divergência</option></select>
                </Campo>
                <Campo rotulo="Identificador *" htmlFor="vc-id"><Input id="vc-id" name="alvo_id" required pattern="[0-9a-fA-F-]{36}" /></Campo>
              </FormularioAcao>
            )}
            {pode(papel, "validar") && selecionado.situacao === "vigente" && (
              <FormularioAcao titulo="Arquivar documento" botao="Arquivar" variante="ghost" acao={arquivarDocumento} ocultos={{ id: selecionado.id }} rotuloSalvar="Arquivar"
                descricao="Nada é apagado. Recibo de obrigação transmitida não é arquivado.">
                <Campo rotulo="Motivo *" htmlFor="ad-m"><textarea id="ad-m" name="motivo" required minLength={10} className={TEXTAREA} /></Campo>
              </FormularioAcao>
            )}
          </>}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-1 text-sm font-bold">Histórico de versões</h3>
              <ol className="space-y-1 text-sm">
                {versoes.map((v) => (
                  <li key={v.id} className={v.id === selecionado.id ? "font-bold" : ""}>
                    v{v.versao} · {v.situacao} · {dataHora(v.enviado_em)} · {v.enviado_por ? n.usuario.get(v.enviado_por) : "sistema"}
                    {v.motivo_substituicao && <span className="font-normal"> — substituição: {v.motivo_substituicao}</span>}
                    {v.arquivo_path && <a className="ml-2 font-normal text-elo hover:underline" href={`${ROTA_CREDITOS}/documentos/${v.id}/baixar`}>baixar</a>}
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-bold">Vínculos</h3>
              {vinculos.length === 0 ? <p className="text-sm text-muted-foreground">Sem vínculos.</p> : (
                <ul className="space-y-1 text-sm">
                  {vinculos.map((v) => <li key={v.id} className={v.removido_em ? "text-muted-foreground line-through" : ""}><Link className="text-elo hover:underline" href={linkAlvo(v.alvo, v.alvo_id)}>{v.alvo}</Link> · desde {dataHora(v.criado_em)}{v.removido_em ? ` · removido: ${v.removido_motivo}` : ""}</li>)}
                </ul>
              )}
              {selecionado.observacoes && <p className="mt-2 whitespace-pre-wrap text-sm">{selecionado.observacoes}</p>}
            </div>
          </div>
        </Secao>
      )}
    </div>
  );
}
