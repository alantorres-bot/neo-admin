import type { Metadata } from "next";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { agregarPorChave, linhaDoBanco, type LinhaApuracao, type LinhaBanco } from "@/lib/modulos/fiscal/creditos/apuracao";
import { centavos, competencia, competenciasDoAno, data, dataHora, moeda, somarMeses } from "@/lib/modulos/fiscal/creditos/formatos";
import { pode, ROTA_CREDITOS, ROTULO_STATUS_PERIODO } from "@/lib/modulos/fiscal/creditos/modulo";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { enviarRevisao, fecharPeriodo, informarSaldos, lerEfdIcmsIpi, reabrirPeriodo, reconciliarPeriodo } from "../acoes";
import { DocumentosVinculados } from "../blocos";
import { Secao, Selo, Vazio } from "../componentes";
import { comFiltros, contexto, lerCadastros, lerFiltros, lerHistorico, nomes } from "../dados";
import { BarraFiltros } from "../filtros";
import { FormDivergencia, FormTarefa } from "../formularios";
import { Campo, CampoValor, FormularioAcao, TEXTAREA } from "../ui";

export const metadata: Metadata = { title: "Apuração mensal" };

type Periodo = {
  id: string; competencia: string; status: string; requer_reconciliacao: boolean; reconciliacao_motivo: string | null; saldo_oficial: string | null;
  saldo_oficial_fonte: string | null; saldo_declarado: string | null; saldo_declarado_fonte: string | null; diferenca_justificativa: string | null;
  fechado_por: string | null; fechado_em: string | null; conferido_por: string | null; enviado_revisao_por: string | null; reaberturas: number; snapshot: Record<string, unknown> | null;
};

const COLUNAS: [keyof LinhaApuracao, string][] = [
  ["saldoInicial", "Saldo inicial"], ["implantado", "dos quais implantado"], ["gerado", "Gerado no período"], ["reconhecido", "Reconhecido (períodos anteriores)"],
  ["ajustesPositivos", "Ajustes (+)"], ["ajustesNegativos", "Ajustes (−)"], ["utilizado", "Utilizado"], ["compensado", "Compensado"],
  ["baixado", "Ressarcido/restituído/baixado"], ["transferidoEntrada", "Transferência recebida"], ["transferidoSaida", "Transferência enviada"], ["saldoFinal", "Saldo final"],
];

export default async function PaginaApuracao({ searchParams }: PageProps<"/fiscal/creditos/apuracao">) {
  const { supabase, papel } = await contexto();
  const hoje = hojeEmCuiaba();
  const f = lerFiltros(await searchParams, Number(hoje.slice(0, 4)));
  const cad = await lerCadastros();
  const n = nomes(cad);
  // Chaves (estabelecimento × tributo) que têm crédito
  const { data: chavesBrutas } = await supabase.from("fis_creditos").select("estabelecimento_id, tributo_id, empresa_id").limit(5000);
  const chaves = [...new Map((chavesBrutas ?? []).filter((k) => !f.empresa || k.empresa_id === f.empresa)
    .map((k) => [`${k.estabelecimento_id}|${k.tributo_id}`, k])).values()]
    .sort((a, b) => `${n.estab.get(a.estabelecimento_id)}${n.tributo.get(a.tributo_id)}`.localeCompare(`${n.estab.get(b.estabelecimento_id)}${n.tributo.get(b.tributo_id)}`));
  const escolhida = chaves.find((k) => (!f.estab || k.estabelecimento_id === f.estab) && (!f.tributo || k.tributo_id === f.tributo));
  const base = { empresa: f.empresa, ano: f.ano };

  if (!escolhida) {
    return (
      <Secao titulo="Apuração mensal">
        <BarraFiltros cad={cad} f={f} campos={["ano", "empresa", "estab", "tributo"]} />
        <div className="mt-3"><Vazio titulo="Nenhum crédito para esta combinação">A apuração é por empresa, estabelecimento, tributo e competência. Cadastre créditos para o estabelecimento e o tributo escolhidos.</Vazio></div>
      </Secao>
    );
  }
  const estab = escolhida.estabelecimento_id, trib = escolhida.tributo_id, empresa = escolhida.empresa_id;
  const meses = competenciasDoAno(f.ano);
  const mesAtual = `${hoje.slice(0, 7)}-01`;
  const sel = f.mes ? meses[f.mes - 1] : meses.filter((m) => m <= mesAtual).at(-1) ?? meses[0];
  const [{ data: ap, error }, { data: pers }, { data: movsMes }, { data: creditos }, { data: obrigs }] = await Promise.all([
    supabase.rpc("fis_apuracao", { p_inicio: meses[0], p_fim: meses[11], p_estabelecimento: estab, p_tributo: trib }),
    supabase.from("fis_periodos").select("*").eq("estabelecimento_id", estab).eq("tributo_id", trib).gte("competencia", meses[0]).lte("competencia", meses[11]),
    supabase.from("fis_movimentos").select("id, numero, credito_id, tipo, valor_assinado, data, descricao, protocolo, status, estornado").eq("estabelecimento_id", estab).eq("tributo_id", trib).eq("competencia", sel).order("numero"),
    supabase.from("fis_creditos").select("id, codigo, descricao").eq("estabelecimento_id", estab).eq("tributo_id", trib),
    supabase.from("fis_obrigacoes").select("id, tipo_id, status, numero_recibo").eq("estabelecimento_id", estab).eq("competencia", sel),
  ]);
  if (error) throw new Error(`Apuração: ${error.message}`);
  const porMes = new Map(agregarPorChave((ap ?? []) as LinhaBanco[]).map((l) => [l.competencia, l]));
  const porCredito = ((ap ?? []) as LinhaBanco[]).filter((l) => l.competencia === sel);
  const periodos = new Map(((pers ?? []) as Periodo[]).map((p) => [p.competencia, p]));
  const p = periodos.get(sel);
  const atual = porMes.get(sel);
  const anterior = porMes.get(somarMeses(sel, -1)) ?? null;
  const codigo = new Map((creditos ?? []).map((c) => [c.id, c.codigo]));
  const hist = p ? await lerHistorico(supabase, "periodo", p.id) : null;
  const { data: eventos } = p ? await supabase.from("fis_periodos_eventos").select("evento, motivo, usuario_id, em").eq("periodo_id", p.id).order("em") : { data: [] };
  const rotuloChave = `${n.estab.get(estab)} · ${n.tributo.get(trib)}`;
  const ocultos = { estabelecimento_id: estab, tributo_id: trib, competencia: sel };
  const diferenca = p?.saldo_oficial !== null && p?.saldo_oficial !== undefined && atual ? atual.saldoFinal - centavos(p.saldo_oficial) : null;
  const url = (mudar: Record<string, string | number | null>) => comFiltros(`${ROTA_CREDITOS}/apuracao`, { ...base, estab, tributo: trib, mes: f.mes }, mudar);
  const ehIcmsIpi = ["ICMS", "IPI"].includes(n.tributo.get(trib) ?? "");

  return (
    <div className="space-y-4">
      <BarraFiltros cad={cad} f={{ ...f, estab, tributo: trib }} campos={["ano", "mes", "empresa", "estab", "tributo"]} />
      <div className="flex flex-wrap gap-1.5 text-xs">
        {chaves.map((k) => (
          <Link key={`${k.estabelecimento_id}|${k.tributo_id}`} href={comFiltros(`${ROTA_CREDITOS}/apuracao`, { ...base, estab: k.estabelecimento_id, tributo: k.tributo_id, mes: f.mes })}
            className={`rounded-[3px] border px-2 py-0.5 ${k === escolhida ? "border-marca bg-marca-clara font-bold" : "hover:bg-muted"}`}>
            {n.estab.get(k.estabelecimento_id)} · {n.tributo.get(k.tributo_id)}
          </Link>
        ))}
      </div>

      <Secao titulo={`Apuração ${f.ano} — ${rotuloChave}`} descricao="Saldo final = saldo inicial + entradas + ajustes líquidos − utilizações − baixas ± transferências. Clique no mês para ver a origem dos valores."
        acoes={<a className="inline-flex h-7 items-center rounded-[3px] border bg-botao-claro px-2.5 font-condensada text-[12px] font-bold" href={`${ROTA_CREDITOS}/relatorios/exportar/apuracao?estab=${estab}&tributo=${trib}&ano=${f.ano}`}>Exportar Excel</a>}>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Competência</TableHead>
            {COLUNAS.map(([, r]) => <TableHead key={r} className="text-right">{r}</TableHead>)}
            <TableHead className="text-right">Saldo oficial</TableHead><TableHead className="text-right">Diferença</TableHead><TableHead>Situação</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {meses.map((m) => {
              const l = porMes.get(m);
              const per = periodos.get(m);
              const dif = l && per?.saldo_oficial != null ? l.saldoFinal - centavos(per.saldo_oficial) : null;
              return (
                <TableRow key={m} className={m === sel ? "bg-marca-clara/60" : ""}>
                  <TableCell><Link className="font-medium text-elo hover:underline" href={url({ mes: Number(m.slice(5, 7)) })}>{competencia(m)}</Link></TableCell>
                  {COLUNAS.map(([k]) => <TableCell key={k} className={`text-right tabular-nums ${k === "saldoFinal" ? "font-medium" : ""}`}>{l ? moeda(l[k] as number) : "—"}</TableCell>)}
                  <TableCell className="text-right tabular-nums">{per?.saldo_oficial != null ? moeda(centavos(per.saldo_oficial)) : "—"}</TableCell>
                  <TableCell className={`text-right tabular-nums ${dif ? "font-bold text-red-700 dark:text-red-400" : ""}`}>{dif === null ? "—" : moeda(dif)}</TableCell>
                  <TableCell>
                    <Selo tom={per?.status === "fechado" ? (per.requer_reconciliacao ? "grave" : "bom") : per?.status === "em_revisao" ? "info" : "neutro"}>
                      {per ? ROTULO_STATUS_PERIODO[per.status] : "Aberta"}{per?.requer_reconciliacao ? " · reconciliar" : ""}
                    </Selo>
                    {l && l.pendentes > 0 && <span className="ml-1 text-[11px] text-amber-700">{l.pendentes} pend.</span>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Secao>

      <div className="grid gap-4 lg:grid-cols-2">
        <Secao titulo={`Competência ${competencia(sel)} × mês anterior`} descricao="Comparação de meses e conferência do transporte do saldo.">
          <Table interativa={false}>
            <TableHeader><TableRow><TableHead></TableHead><TableHead className="text-right">{competencia(somarMeses(sel, -1))}</TableHead><TableHead className="text-right">{competencia(sel)}</TableHead><TableHead className="text-right">Variação</TableHead></TableRow></TableHeader>
            <TableBody>
              {COLUNAS.map(([k, r]) => {
                const a = anterior ? (anterior[k] as number) : 0, b = atual ? (atual[k] as number) : 0;
                return <TableRow key={k}><TableCell>{r}</TableCell><TableCell className="text-right tabular-nums">{moeda(a)}</TableCell><TableCell className="text-right tabular-nums">{moeda(b)}</TableCell><TableCell className="text-right tabular-nums">{moeda(b - a)}</TableCell></TableRow>;
              })}
            </TableBody>
          </Table>
          {anterior && atual && (
            <p className={`mt-2 text-xs ${anterior.saldoFinal === atual.saldoInicial - atual.implantado ? "text-emerald-700 dark:text-emerald-400" : "font-bold text-red-700"}`}>
              {anterior.saldoFinal === atual.saldoInicial - atual.implantado ? "✓ Saldo inicial confere com o saldo final do mês anterior." : "✕ Saldo inicial difere do saldo final do mês anterior."}
            </p>
          )}
        </Secao>

        <Secao titulo={`Fechamento de ${competencia(sel)}`} descricao="Fechada, a competência não recebe lançamentos; corrigir exige reabrir com motivo (revisor/administrador).">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Situação</dt><dd>{p ? ROTULO_STATUS_PERIODO[p.status] : "Aberta"}{p?.reaberturas ? ` (reaberta ${p.reaberturas}×)` : ""}</dd>
            <dt className="text-muted-foreground">Responsável pela conferência</dt><dd>{p?.conferido_por ? n.usuario.get(p.conferido_por) : "—"}</dd>
            <dt className="text-muted-foreground">Fechada por / em</dt><dd>{p?.fechado_por ? `${n.usuario.get(p.fechado_por)} em ${dataHora(p.fechado_em)}` : p?.fechado_em ? `sistema em ${dataHora(p.fechado_em)}` : "—"}</dd>
            <dt className="text-muted-foreground">Saldo oficial</dt><dd>{p?.saldo_oficial != null ? `${moeda(centavos(p.saldo_oficial))} (${p.saldo_oficial_fonte ?? "fonte não informada"})` : "não informado"}</dd>
            <dt className="text-muted-foreground">Saldo declarado</dt><dd>{p?.saldo_declarado != null ? `${moeda(centavos(p.saldo_declarado))} (${p.saldo_declarado_fonte ?? "—"})` : "não informado"}</dd>
            {diferenca !== null && <><dt className="text-muted-foreground">Diferença calculado × oficial</dt><dd className={diferenca ? "font-bold text-red-700" : ""}>{moeda(diferenca)}{p?.diferenca_justificativa ? ` — ${p.diferenca_justificativa}` : ""}</dd></>}
            {p?.requer_reconciliacao && <><dt className="text-muted-foreground">Reconciliação</dt><dd className="text-red-700">{p.reconciliacao_motivo}</dd></>}
            <dt className="text-muted-foreground">Obrigações da competência</dt>
            <dd>{(obrigs ?? []).length === 0 ? "—" : (obrigs ?? []).map((o) => <Link key={o.id} href={`${ROTA_CREDITOS}/obrigacoes/${o.id}`} className="mr-2 text-elo hover:underline">{n.tipoObr.get(o.tipo_id)} ({o.status}{o.numero_recibo ? `, recibo ${o.numero_recibo}` : ""})</Link>)}</dd>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            {pode(papel, "lancar") && p?.status !== "fechado" && (
              <FormularioAcao titulo={`Saldos oficiais de ${competencia(sel)}`} botao="Informar saldo oficial/declarado" acao={informarSaldos} ocultos={ocultos}
                descricao="Saldo da apuração oficial (EFD, livro…) e da declaração, para comparar com o calculado.">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo rotulo="Saldo oficial (R$)" htmlFor="saldo_oficial"><CampoValor name="saldo_oficial" permitirZero defaultValue={p?.saldo_oficial ?? ""} /></Campo>
                  <Campo rotulo="Fonte" htmlFor="ap-f1"><Input id="ap-f1" name="saldo_oficial_fonte" defaultValue={p?.saldo_oficial_fonte ?? ""} placeholder="EFD ICMS/IPI 09/2026" /></Campo>
                  <Campo rotulo="Saldo declarado (R$)" htmlFor="saldo_declarado"><CampoValor name="saldo_declarado" permitirZero defaultValue={p?.saldo_declarado ?? ""} /></Campo>
                  <Campo rotulo="Fonte" htmlFor="ap-f2"><Input id="ap-f2" name="saldo_declarado_fonte" defaultValue={p?.saldo_declarado_fonte ?? ""} /></Campo>
                  <Campo rotulo="Justificativa da diferença" htmlFor="ap-j" className="sm:col-span-2"><textarea id="ap-j" name="diferenca_justificativa" className={TEXTAREA} defaultValue={p?.diferenca_justificativa ?? ""} /></Campo>
                </div>
              </FormularioAcao>
            )}
            {pode(papel, "lancar") && p?.status !== "fechado" && ehIcmsIpi && (
              <FormularioAcao titulo="Ler saldo da EFD ICMS/IPI" botao="Ler arquivo EFD" acao={lerEfdIcmsIpi}
                descricao="Lê só o 0000 (CNPJ e período), o E110 (saldo credor de ICMS a transportar) e o E520 (saldo credor de IPI). Leitura experimental: confira o resultado.">
                <Input name="arquivo" type="file" accept=".txt" required aria-label="Arquivo da EFD" />
              </FormularioAcao>
            )}
            {pode(papel, "lancar") && (!p || p.status === "aberto") && (
              <FormularioAcao titulo="Enviar para revisão" botao="Enviar para revisão" acao={enviarRevisao} ocultos={ocultos}>
                <Campo rotulo="Observação" htmlFor="ap-rv"><textarea id="ap-rv" name="observacao" className={TEXTAREA} /></Campo>
              </FormularioAcao>
            )}
            {pode(papel, "fechar") && p?.status !== "fechado" && (
              <FormularioAcao titulo={`Fechar ${competencia(sel)} — ${rotuloChave}`} botao="Fechar competência" variante="default" acao={fecharPeriodo} ocultos={ocultos} rotuloSalvar="Fechar"
                descricao="Exige competências anteriores fechadas, nenhum lançamento pendente e, se houver diferença com o saldo oficial ou divergência aberta, justificativa.">
                <Campo rotulo="Justificativa (diferença ou divergências)" htmlFor="ap-fj"><textarea id="ap-fj" name="justificativa" className={TEXTAREA} /></Campo>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="aceitar" /> Fechar mesmo com divergência aberta</label>
              </FormularioAcao>
            )}
            {pode(papel, "reabrir") && p?.status === "fechado" && (
              <FormularioAcao titulo={`Reabrir ${competencia(sel)}`} botao="Reabrir" acao={reabrirPeriodo} ocultos={{ id: p.id }} rotuloSalvar="Reabrir"
                descricao="Procedimento auditável. Se o saldo mudar, as competências fechadas seguintes ficam marcadas para reconciliação.">
                <Campo rotulo="Motivo *" htmlFor="ap-rm"><textarea id="ap-rm" name="motivo" required minLength={15} className={TEXTAREA} /></Campo>
              </FormularioAcao>
            )}
            {pode(papel, "fechar") && p?.requer_reconciliacao && (
              <FormularioAcao titulo={`Reconciliar ${competencia(sel)}`} botao="Reconciliar" variante="default" acao={reconciliarPeriodo} ocultos={{ id: p.id }} rotuloSalvar="Reconciliar"
                descricao={`Saldo congelado: ${moeda(centavos(String(p.snapshot?.saldo_final ?? 0)))}; calculado hoje: ${moeda(atual?.saldoFinal ?? 0)}. Registre a conferência.`}>
                <Campo rotulo="Conferência feita *" htmlFor="ap-rc"><textarea id="ap-rc" name="observacao" required minLength={10} className={TEXTAREA} /></Campo>
              </FormularioAcao>
            )}
            {pode(papel, "lancar") && <FormDivergencia cad={cad} padrao={{ empresa_id: empresa, estabelecimento_id: estab, tributo_id: trib, competencia: sel, ...(p ? { periodo_id: p.id } : {}),
              valor_interno: atual ? (atual.saldoFinal / 100).toFixed(2) : "", valor_externo: p?.saldo_oficial ?? "" }} />}
            {pode(papel, "lancar") && p && <FormTarefa cad={cad} empresa={empresa} alvo="periodo" alvoId={p.id} botao="Pedir revisão" tipoPadrao="revisao_apuracao" tituloPadrao={`Revisar apuração ${rotuloChave} ${competencia(sel)}`} />}
          </div>
          {(eventos ?? []).length > 0 && (
            <ol className="mt-3 space-y-1 border-t pt-2 text-xs">
              {(eventos ?? []).map((e, i) => <li key={i}>{dataHora(e.em)} · {e.usuario_id ? n.usuario.get(e.usuario_id) : "sistema"} · <strong>{e.evento.replace("_", " ")}</strong>{e.motivo ? ` — ${e.motivo}` : ""}</li>)}
            </ol>
          )}
        </Secao>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Secao titulo={`Origem dos valores de ${competencia(sel)} por crédito`}>
          {porCredito.length === 0 ? <p className="text-sm text-muted-foreground">Sem créditos nesta competência.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Crédito</TableHead><TableHead className="text-right">Saldo inicial</TableHead><TableHead className="text-right">Entradas</TableHead><TableHead className="text-right">Saídas</TableHead><TableHead className="text-right">Saldo final</TableHead></TableRow></TableHeader>
              <TableBody>
                {porCredito.map((b) => {
                  const l = linhaDoBanco(b);
                  const ent = l.gerado + l.reconhecido + l.ajustesPositivos + l.transferidoEntrada;
                  const sai = l.utilizado + l.compensado + l.baixado + l.ajustesNegativos + l.transferidoSaida;
                  return (
                    <TableRow key={b.credito_id}>
                      <TableCell><Link className="text-elo hover:underline" href={`${ROTA_CREDITOS}/creditos/${b.credito_id}`}>{codigo.get(b.credito_id)}</Link></TableCell>
                      <TableCell className="text-right tabular-nums">{moeda(l.saldoInicial)}</TableCell><TableCell className="text-right tabular-nums">{moeda(ent)}</TableCell>
                      <TableCell className="text-right tabular-nums">{moeda(sai)}</TableCell><TableCell className="text-right tabular-nums">{moeda(l.saldoFinal)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Secao>
        <Secao titulo={`Lançamentos de ${competencia(sel)}`}>
          {(movsMes ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Sem lançamentos.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Nº</TableHead><TableHead>Crédito</TableHead><TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
              <TableBody>
                {(movsMes ?? []).map((m) => (
                  <TableRow key={m.id} className={m.estornado || m.status === "rejeitado" ? "text-muted-foreground" : ""}>
                    <TableCell>{m.numero}</TableCell><TableCell>{codigo.get(m.credito_id)}</TableCell><TableCell>{data(m.data)}</TableCell>
                    <TableCell title={m.descricao}>{n.tipoMov.get(m.tipo)}</TableCell><TableCell className="text-right tabular-nums">{moeda(centavos(m.valor_assinado))}</TableCell>
                    <TableCell>{m.estornado ? "Estornado" : m.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="mt-2 text-xs"><Link className="text-elo hover:underline" href={comFiltros(`${ROTA_CREDITOS}/movimentos`, { estab, tributo: trib, ano: f.ano, mes: Number(sel.slice(5, 7)) })}>Abrir no livro de movimentações →</Link></p>
        </Secao>
      </div>
      {p && hist && (
        <Secao titulo="Documentos e declarações da competência">
          <DocumentosVinculados docs={hist.documentos} cad={cad} papel={papel} empresa={empresa} alvo="periodo" alvoId={p.id} tipoPadrao="arquivo_apuracao" />
        </Secao>
      )}
    </div>
  );
}
