import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AnexarBoleto } from "@/app/(plataforma)/financeiro/recebiveis/[id]/componentes";
import { MODULO_FILIAL, ROTA_FILIAL, ROTULO_DOCUMENTO_KIT, TIPOS_DOCUMENTO_KIT, type TipoDocumentoKit } from "@/lib/modulos/financeiro/filial/arquivos";
import { montarEmailCliente, type ModoEmailCliente } from "@/lib/modulos/financeiro/filial/email-cliente";
import {
  DONO_ESTAGIO, ROTULO_ESTAGIO_FILA, ROTULO_URGENCIA, situacaoDaNota, textoVencimento, urgenciaDaNota, type KitParaSituacao, type Papel,
} from "@/lib/modulos/financeiro/filial/estagios";
import { lerConfigImplantacao, montarFichaImplantacao } from "@/lib/modulos/financeiro/filial/implantacao";
import { divergencias, lerParcelasInformadas } from "@/lib/modulos/financeiro/filial/remessa";
import { emCentavos } from "@/lib/modulos/financeiro/recebiveis/carteira";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { hojeEmCuiaba } from "@/lib/nucleo/fila";
import { urlAssinadaAnexo } from "@/lib/nucleo/anexos";
import type { Sessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { AnexarDocumento, BotaoCancelarKit } from "./[id]/componentes";
import { EmailCliente } from "./[id]/email-cliente";
import { RelatorioImplantacao } from "./remessas/[numero]/implantacao";

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
export const COR_URGENCIA = { atrasada: "destructive", critica: "destructive", atencao: "outline", normal: "secondary", sem_data: "secondary" } as const;

/**
 * Tudo de uma NF da fila, no painel lateral: situação (estágio, urgência, tarefas de cada lado), documentos, implantação na
 * CCFT040 e boleto (Cuiabá), e-mail ao cliente no modo certo (filial) e parcelas no Consistem. Só o que serve no estágio.
 */
export async function ConteudoKit({ kitId, sessao, papel, podeOperar }: { kitId: string; sessao: Sessao; papel: Papel; podeOperar: boolean }) {
  const supabase = await criarClienteServidor();
  const { data: k } = await supabase.from("rec_vw_kits").select("*").eq("id", kitId).maybeSingle();
  if (!k) return <p className="text-sm text-muted-foreground">NF não encontrada.</p>;
  const hoje = hojeEmCuiaba();

  const [{ data: ligacoes }, { data: extra }, { data: remessas }] = await Promise.all([
    supabase.from("rec_kit_titulos").select("titulo_id").eq("kit_id", kitId),
    supabase.from("rec_kits").select("parcelas_informadas, nota_enviada_em, email_assunto, data_emissao, cliente_documento, cliente_codigo_erp, cliente_conferido_em").eq("id", kitId).maybeSingle(),
    supabase.from("rec_remessa_kits").select("rec_remessas(numero)").eq("kit_id", kitId),
  ]);
  const informadas = lerParcelasInformadas(extra?.parcelas_informadas);
  const numerosRemessa = (remessas ?? []).map((r) => ((Array.isArray(r.rec_remessas) ? r.rec_remessas[0] : r.rec_remessas) as { numero?: number } | null)?.numero).filter((n): n is number => !!n).sort((a, b) => a - b);
  const idsTitulos = (ligacoes ?? []).map((l) => l.titulo_id as string);
  type Titulo = { id: string; documento: string; vencimento: string; valor: number | string; estagio: string; cedido: boolean; forma_pagamento: string | null; contraparte_id: string; contrapartes: { codigo_erp: string | null } | { codigo_erp: string | null }[] | null };
  const [{ data: titulosBrutos }, { data: docsKit }, { data: boletos }, { data: configImplantacao }] = await Promise.all([
    idsTitulos.length
      ? supabase.from("rec_titulos").select("id, documento, vencimento, valor, estagio, cedido, forma_pagamento, contraparte_id, contrapartes(codigo_erp)").in("id", idsTitulos).order("documento")
      : Promise.resolve({ data: [] }),
    supabase.from("anexos").select("id, tipo, nome_arquivo, arquivo_path, enviado_em").eq("referencia_tabela", "rec_kits").eq("referencia_id", kitId).order("enviado_em"),
    idsTitulos.length
      ? supabase.from("anexos").select("referencia_id, nome_arquivo, arquivo_path, enviado_em").eq("referencia_tabela", "rec_titulos").eq("tipo", "boleto").in("referencia_id", idsTitulos).order("enviado_em")
      : Promise.resolve({ data: [] }),
    supabase.from("configuracoes").select("valor").eq("chave", "financeiro.filial.implantacao").maybeSingle(),
  ]);
  const titulos = (titulosBrutos ?? []) as unknown as Titulo[];
  const ativos = titulos.filter((t) => t.estagio !== "cancelado" && t.estagio !== "renegociado");

  const documentos = await Promise.all((docsKit ?? []).map(async (d) => {
    const r = await urlAssinadaAnexo(supabase, d.arquivo_path as string, 900);
    return { ...d, url: r.ok ? r.url : null };
  }));
  const boletoPorTitulo = new Map<string, { nome: string; url: string | null }>();
  for (const b of boletos ?? []) {
    const r = await urlAssinadaAnexo(supabase, b.arquivo_path as string, 900);
    boletoPorTitulo.set(b.referencia_id as string, { nome: b.nome_arquivo as string, url: r.ok ? r.url : null });
  }

  // Situação: estágio da fila, tarefas de cada lado e urgência pelo vencimento.
  const notaEnviadaEm = (extra?.nota_enviada_em as string | null) ?? null;
  const entrada: KitParaSituacao = {
    estagio: k.estagio, notas: k.notas, demonstrativos: k.demonstrativos, cartas: k.cartas, exigeCarta: !!k.exige_carta,
    parcelas: k.parcelas ?? 0, boletos: k.boletos ?? 0, notaEnviada: !!notaEnviadaEm,
  };
  const situacao = situacaoDaNota(entrada);
  const vencimento = (k.primeiro_vencimento as string | null) ?? informadas[0]?.vencimento ?? null;
  const urgencia = urgenciaDaNota(situacao.estagio, vencimento, hoje);
  const aberto = k.estagio !== "enviada" && k.estagio !== "cancelada";
  const ehCuiaba = papel === "cuiaba";

  // CCFT040 (Cuiabá, antes da implantação).
  const cfg = lerConfigImplantacao(configImplantacao?.valor);
  const codigoDoTitulo = ativos.map((t) => (Array.isArray(t.contrapartes) ? t.contrapartes[0] : t.contrapartes)?.codigo_erp).find(Boolean) ?? null;
  const blocoImplantacao = ehCuiaba && k.estagio === "recebida" ? [{
    kitId, nota: k.nota_fiscal as string, cliente: k.cliente_nome as string, semBoletoFactoring: !k.aceita_boleto_factoring, titulos: [], divergencias: [],
    ficha: montarFichaImplantacao({
      nota: k.nota_fiscal, emissao: (extra?.data_emissao as string | null) ?? null, clienteNome: k.cliente_nome,
      clienteDocumento: (extra?.cliente_documento as string | null) ?? null, clienteCodigoErp: (extra?.cliente_codigo_erp as string | null) ?? codigoDoTitulo,
      clienteConferido: !!extra?.cliente_conferido_em || !!codigoDoTitulo, parcelas: informadas,
    }, cfg),
  }] : [];

  // E-mail ao cliente (filial): completo quando pronta; boleto em resposta quando a nota já foi; antes do boleto, só como exceção.
  const tiposKit = new Set((docsKit ?? []).map((d) => d.tipo as string));
  const podeNotaAntes = (k.estagio === "recebida" || k.estagio === "implantada") && !notaEnviadaEm && tiposKit.has("nota_fatura") && tiposKit.has("demonstrativo");
  const modoEmail: ModoEmailCliente | null = situacao.estagio === "pronta" ? "completo" : situacao.estagio === "boleto_a_enviar" ? "boleto" : podeNotaAntes ? "nota" : null;
  let email: { gmail: string | null; sugestao: { para: string; cc: string; assunto: string; corpo: string }; anexos: string[] } | null = null;
  if (modoEmail && podeOperar) {
    const [{ data: conta }, { data: ultima }, { data: contatos }, { data: copia }] = await Promise.all([
      supabase.from("gmail_contas").select("email").eq("perfil_id", sessao.userId).is("desconectado_em", null).maybeSingle(),
      k.contraparte_id
        ? supabase.from("mensagens").select("destinatario, cc").eq("modulo", MODULO_FILIAL).eq("contraparte_id", k.contraparte_id).order("criado_em", { ascending: false }).limit(1).maybeSingle()
        : Promise.resolve({ data: null }),
      k.contraparte_id ? supabase.from("contatos").select("email").eq("contraparte_id", k.contraparte_id).eq("ativo", true).not("email", "is", null) : Promise.resolve({ data: [] }),
      supabase.from("configuracoes").select("valor").eq("chave", "financeiro.filial.copia_cliente").maybeSingle(),
    ]);
    const tipos = [...new Set((docsKit ?? []).map((d) => d.tipo as TipoDocumentoKit))];
    const hora = Number(new Date().toLocaleString("en-US", { timeZone: "America/Cuiaba", hour: "2-digit", hour12: false }));
    const texto = montarEmailCliente({
      cliente: k.cliente_nome, nota: k.nota_fiscal, obra: k.obra, periodoInicio: k.periodo_inicio, periodoFim: k.periodo_fim, documentos: tipos, hora,
      modo: modoEmail, assuntoAnterior: (extra?.email_assunto as string | null) ?? null,
    });
    const qtdBoletos = ativos.filter((t) => boletoPorTitulo.has(t.id)).length;
    const rotulosDocs = tipos.filter((t) => modoEmail === "completo" || (modoEmail === "nota" ? t !== "carta_cessao" : t === "carta_cessao")).map((t) => ROTULO_DOCUMENTO_KIT[t].toLowerCase());
    email = {
      gmail: (conta?.email as string | undefined) ?? null,
      sugestao: {
        para: (ultima?.destinatario as string | undefined) ?? (contatos ?? []).map((c) => c.email as string).join(", "),
        cc: (ultima?.cc as string | undefined) ?? (Array.isArray(copia?.valor) ? (copia.valor as string[]).join(", ") : ""),
        ...texto,
      },
      anexos: [...rotulosDocs, ...(modoEmail !== "nota" && qtdBoletos ? [qtdBoletos === 1 ? "boleto" : "boletos"] : [])],
    };
  }
  const divergentes = divergencias(informadas, ativos.map((t) => ({ documento: t.documento, vencimento: t.vencimento, valorCentavos: emCentavos(t.valor) })));
  const dono = DONO_ESTAGIO[situacao.estagio];

  return (
    <div className="space-y-4">
      {/* Situação */}
      <div className="space-y-2 rounded-[3px] border border-grade bg-cabecalho p-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{ROTULO_ESTAGIO_FILA[situacao.estagio]}</Badge>
          {urgencia && urgencia !== "sem_data" && <Badge variant={COR_URGENCIA[urgencia]}>{ROTULO_URGENCIA[urgencia]} · {textoVencimento(vencimento, hoje)}</Badge>}
          {k.cedido && <Badge variant="outline">AKF</Badge>}
          {!k.aceita_boleto_factoring && <Badge variant="outline">Sem boleto de factoring</Badge>}
          {numerosRemessa.map((n) => <Link key={n} className="underline" href={`${ROTA_FILIAL}/remessas/${n}`}>Remessa nº {n}</Link>)}
        </div>
        {aberto && (
          <ul className="space-y-0.5">
            <li><strong>Filial:</strong> {situacao.tarefas.filial.length ? situacao.tarefas.filial.join(" · ") : "nada a fazer agora"}</li>
            <li><strong>Cuiabá:</strong> {situacao.tarefas.cuiaba.length ? situacao.tarefas.cuiaba.join(" · ") : "nada a fazer agora"}</li>
          </ul>
        )}
        {papel === "filial" && dono === "cuiaba" && (urgencia === "critica" || urgencia === "atrasada") && (
          <p className="font-medium text-destructive">Vencimento próximo e o boleto ainda está com Cuiabá: cobre o boleto de Cuiabá.</p>
        )}
        {notaEnviadaEm && aberto && <p>Nota e demonstrativo enviados ao cliente em {quando(notaEnviadaEm)}; o boleto vai como resposta ao mesmo e-mail.</p>}
        {k.estagio === "enviada" && <p>Enviada ao cliente em {quando(k.enviado_em)}. A cobrança segue a régua normal.</p>}
        <p className="text-muted-foreground">
          {k.obra && <>Obra: {k.obra} · </>}
          {informadas.length > 0 && <>Na nota: {informadas.map((p) => `${formatarData(p.vencimento)} · ${formatarMoeda(p.valorCentavos)}`).join("; ")} · </>}
          Registrada por {k.criado_por_nome ?? "—"} em {quando(k.criado_em)}
        </p>
        {divergentes.length > 0 && <ul className="list-disc pl-5 text-destructive">{divergentes.map((d) => <li key={d}>{d}</li>)}</ul>}
      </div>

      {/* E-mail ao cliente: o principal quando pronta; antes do boleto, exceção discreta */}
      {email && modoEmail && modoEmail !== "nota" && (
        <Suspense><EmailCliente kitId={kitId} modo={modoEmail} gmail={email.gmail} sugestao={email.sugestao} anexos={email.anexos} /></Suspense>
      )}

      {/* Implantação (Cuiabá) */}
      {blocoImplantacao.length > 0 && <RelatorioImplantacao blocos={blocoImplantacao} rotina={cfg.rotina} podeOperar={podeOperar} />}

      {/* Documentos */}
      <Card size="sm">
        <CardHeader>
          <CardTitle>Documentos</CardTitle>
          <CardDescription>Nota fatura e demonstrativo (um ou mais) vêm da filial; a carta de cessão, de Cuiabá, se o cliente pedir.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-1 text-[13px]">
            {documentos.length === 0 && <li className="text-muted-foreground">Nenhum documento.</li>}
            {documentos.map((d) => (
              <li key={d.id as string}>
                <span className="text-muted-foreground">{ROTULO_DOCUMENTO_KIT[d.tipo as TipoDocumentoKit] ?? d.tipo}:</span>{" "}
                {d.url ? <a className="underline" href={d.url} target="_blank" rel="noreferrer">{d.nome_arquivo as string}</a> : (d.nome_arquivo as string)}
                <span className="text-muted-foreground"> · {quando(d.enviado_em as string)}</span>
              </li>
            ))}
          </ul>
          {podeOperar && aberto && (
            <AnexarDocumento kitId={kitId} tipos={[...TIPOS_DOCUMENTO_KIT]}
              sugerido={k.demonstrativos === 0 ? "demonstrativo" : ehCuiaba && k.exige_carta && k.cartas === 0 ? "carta_cessao" : null} />
          )}
        </CardContent>
      </Card>

      {/* Parcelas e boleto */}
      <Card size="sm">
        <CardHeader>
          <CardTitle>Parcelas e boleto</CardTitle>
          <CardDescription>{ativos.length === 0 ? "Ainda não implantada no Consistem." : "Títulos do Consistem desta NF e o boleto de cada um."}</CardDescription>
        </CardHeader>
        {ativos.length > 0 && (
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Título</TableHead><TableHead>Vencimento</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Boleto</TableHead></TableRow></TableHeader>
              <TableBody>
                {ativos.map((t) => {
                  const b = boletoPorTitulo.get(t.id);
                  return (
                    <TableRow key={t.id}>
                      <TableCell>{sessao.acesso.restrito ? t.documento : <Link className="underline" href={`/financeiro/recebiveis/${t.id}`}>{t.documento}</Link>}{t.cedido && <Badge variant="outline" className="ml-1">AKF</Badge>}</TableCell>
                      <TableCell>{formatarData(t.vencimento)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatarMoeda(emCentavos(t.valor))}</TableCell>
                      <TableCell className="text-[13px]">
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {b ? (b.url ? <a className="underline" href={b.url} target="_blank" rel="noreferrer">{b.nome}</a> : b.nome)
                            : t.forma_pagamento === "transferencia" ? <span className="text-muted-foreground">transferência</span>
                              : <span className="text-muted-foreground">falta</span>}
                          {ehCuiaba && podeOperar && aberto && t.forma_pagamento !== "transferencia" && <AnexarBoleto tituloId={t.id} temBoleto={!!b} />}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>

      {/* Exceção: nota antes do boleto */}
      {email && modoEmail === "nota" && (
        <details className="rounded-[3px] border border-dashed p-3 text-[13px]">
          <summary className="cursor-pointer text-muted-foreground">Enviar a nota antes do boleto (exceção; o recomendado é enviar tudo junto)</summary>
          <div className="mt-3"><Suspense><EmailCliente kitId={kitId} modo="nota" gmail={email.gmail} sugestao={email.sugestao} anexos={email.anexos} /></Suspense></div>
        </details>
      )}

      {podeOperar && aberto && <div className="flex justify-end"><BotaoCancelarKit id={kitId} nota={k.nota_fiscal} /></div>}
    </div>
  );
}
