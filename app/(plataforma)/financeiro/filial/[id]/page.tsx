import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  COR_ESTAGIO_KIT as COR_ESTAGIO, MODULO_FILIAL, pendenciasDoKit, ROTA_FILIAL, ROTULO_DOCUMENTO_KIT, ROTULO_ESTAGIO_KIT, TIPOS_DOCUMENTO_KIT, type EstagioKit, type TipoDocumentoKit,
} from "@/lib/modulos/financeiro/filial/arquivos";
import { divergencias, lerParcelasInformadas } from "@/lib/modulos/financeiro/filial/remessa";
import { emCentavos } from "@/lib/modulos/financeiro/recebiveis/carteira";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { urlAssinadaAnexo } from "@/lib/nucleo/anexos";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { Suspense } from "react";
import { montarEmailCliente } from "@/lib/modulos/financeiro/filial/email-cliente";
import { AnexarDocumento, BotaoCancelarKit } from "./componentes";
import { EmailCliente } from "./email-cliente";

export const metadata: Metadata = { title: "Kit da fatura da filial" };

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Cuiaba", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const ETAPAS: EstagioKit[] = ["recebida", "implantada", "pronta", "enviada"];

export default async function PaginaKit({ params }: PageProps<"/financeiro/filial/[id]">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_FILIAL);
  if (!modulo || !modulo.ativo || !temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_FILIAL)) notFound();
  const podeOperar = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_FILIAL, "operador");

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await criarClienteServidor();
  const { data: k } = await supabase.from("rec_vw_kits").select("*").eq("id", id).maybeSingle();
  if (!k) notFound();

  const [{ data: ligacoes }, { data: extra }] = await Promise.all([
    supabase.from("rec_kit_titulos").select("titulo_id").eq("kit_id", id),
    supabase.from("rec_kits").select("parcelas_informadas").eq("id", id).maybeSingle(),
  ]);
  const informadas = lerParcelasInformadas(extra?.parcelas_informadas);
  const idsTitulos = (ligacoes ?? []).map((l) => l.titulo_id as string);
  const [{ data: titulos }, { data: docsKit }, { data: boletos }] = await Promise.all([
    idsTitulos.length
      ? supabase.from("rec_titulos").select("id, documento, vencimento, valor, estagio, cedido, forma_pagamento, linha_digitavel").in("id", idsTitulos).order("documento")
      : Promise.resolve({ data: [] as { id: string; documento: string; vencimento: string; valor: number | string; estagio: string; cedido: boolean; forma_pagamento: string | null; linha_digitavel: string | null }[] }),
    supabase.from("anexos").select("id, tipo, nome_arquivo, arquivo_path, enviado_em").eq("referencia_tabela", "rec_kits").eq("referencia_id", id).order("enviado_em"),
    idsTitulos.length
      ? supabase.from("anexos").select("referencia_id, nome_arquivo, arquivo_path, enviado_em").eq("referencia_tabela", "rec_titulos").eq("tipo", "boleto").in("referencia_id", idsTitulos).order("enviado_em")
      : Promise.resolve({ data: [] as { referencia_id: string; nome_arquivo: string; arquivo_path: string; enviado_em: string }[] }),
  ]);

  // Links assinados (bucket privado) válidos por 15 minutos; vale o boleto mais recente de cada parcela.
  const documentos = await Promise.all((docsKit ?? []).map(async (d) => {
    const r = await urlAssinadaAnexo(supabase, d.arquivo_path as string, 900);
    return { ...d, url: r.ok ? r.url : null };
  }));
  const boletoPorTitulo = new Map<string, { nome: string; url: string | null }>();
  for (const b of boletos ?? []) {
    const r = await urlAssinadaAnexo(supabase, b.arquivo_path as string, 900);
    boletoPorTitulo.set(b.referencia_id as string, { nome: b.nome_arquivo as string, url: r.ok ? r.url : null });
  }

  const estagio = k.estagio as EstagioKit;
  const faltas = pendenciasDoKit({
    estagio, notas: k.notas, demonstrativos: k.demonstrativos, comodatos: k.comodatos, cartas: k.cartas,
    parcelas: k.parcelas ?? 0, boletos: k.boletos ?? 0, exigeCarta: !!k.exige_carta,
    parcelasTransferencia: (titulos ?? []).filter((t) => t.forma_pagamento === "transferencia" && !boletoPorTitulo.has(t.id)).length,
  });
  const aberto = estagio !== "enviada" && estagio !== "cancelada";

  // E-mail ao cliente (Fase C): sugestão de destinatário (último e-mail da filial a este cliente; senão, contatos com e-mail),
  // cópia interna configurada, texto no modelo da filial e o Gmail conectado de quem está vendo.
  let email: { gmail: string | null; sugestao: { para: string; cc: string; assunto: string; corpo: string }; anexos: string[] } | null = null;
  if (estagio === "pronta") {
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
    });
    const copiaPadrao = Array.isArray(copia?.valor) ? (copia.valor as string[]).join(", ") : "";
    email = {
      gmail: (conta?.email as string | undefined) ?? null,
      sugestao: {
        para: (ultima?.destinatario as string | undefined) ?? (contatos ?? []).map((c) => c.email as string).join(", "),
        cc: (ultima?.cc as string | undefined) ?? copiaPadrao,
        ...texto,
      },
      anexos: [
        ...tipos.map((t) => ROTULO_DOCUMENTO_KIT[t].toLowerCase()),
        ...((titulos ?? []).filter((t) => boletoPorTitulo.has(t.id)).length ? [`${(titulos ?? []).filter((t) => boletoPorTitulo.has(t.id)).length === 1 ? "boleto" : "boletos"}`] : []),
      ],
    };
  }
  const divergentes = divergencias(informadas, (titulos ?? []).filter((t) => t.estagio !== "cancelado" && t.estagio !== "renegociado")
    .map((t) => ({ documento: t.documento, vencimento: t.vencimento, valorCentavos: emCentavos(t.valor) })));
  const etapaAtual = ETAPAS.indexOf(estagio);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" render={<Link href={ROTA_FILIAL} />}><ArrowLeft /> Faturamento Filial</Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            NF {k.nota_fiscal} — {k.cliente_nome}
            <Badge variant={COR_ESTAGIO[estagio]}>{ROTULO_ESTAGIO_KIT[estagio]}</Badge>
            {k.cedido && <Badge variant="outline">Cedido à AKF</Badge>}
            {!k.aceita_boleto_factoring && <Badge variant="outline">Sem boleto de factoring</Badge>}
          </h1>
          <p className="text-sm text-muted-foreground">
            {k.obra && <>Obra: {k.obra} · </>}
            {k.periodo_inicio && <>Período {formatarData(k.periodo_inicio)} a {formatarData(k.periodo_fim)} · </>}
            Registrada por {k.criado_por_nome ?? "—"} em {quando(k.criado_em)}
          </p>
          {k.motivo_cancelamento && <p className="mt-1 text-sm"><strong>Motivo do cancelamento:</strong> {k.motivo_cancelamento}</p>}
        </div>
        {podeOperar && aberto && <BotaoCancelarKit id={id} nota={k.nota_fiscal} />}
      </div>

      {estagio !== "cancelada" && (
        <ol className="flex flex-wrap gap-2 text-[13px]" aria-label="Esteira do kit">
          {ETAPAS.map((e, i) => (
            <li key={e} className={`rounded-[3px] border px-2 py-1 ${i <= etapaAtual ? "border-marca bg-marca-clara" : "text-muted-foreground"}`}>
              {i + 1}. {ROTULO_ESTAGIO_KIT[e]}
            </li>
          ))}
        </ol>
      )}
      {faltas.length > 0 && <p className="text-sm"><strong>Falta:</strong> {faltas.join(", ")}.</p>}
      {informadas.length > 0 && (
        <p className="text-sm">
          <strong>Na nota:</strong> {informadas.map((p) => `venc. ${formatarData(p.vencimento)} · ${formatarMoeda(p.valorCentavos)}`).join("; ")}
        </p>
      )}
      {divergentes.length > 0 && (
        <div role="alert" className="rounded-[3px] border border-destructive p-3 text-sm">
          <strong>A nota não confere com o Consistem:</strong>
          <ul className="list-disc pl-5">{divergentes.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
      )}

      {email && <Suspense><EmailCliente kitId={id} gmail={email.gmail} sugestao={email.sugestao} anexos={email.anexos} /></Suspense>}
      {estagio === "enviada" && <p className="text-sm">Enviado ao cliente em {quando(k.enviado_em)}. A partir daqui, a cobrança segue a régua normal.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Documentos</CardTitle>
            <CardDescription>Nota fatura, demonstrativo e comodato vêm da filial; a carta de cessão, de Cuiabá — obrigatória só para cliente marcado &quot;exige carta de cessão&quot; com parcela cedida. Nada é apagado: para substituir, anexe outro.</CardDescription>
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
            {podeOperar && aberto && <AnexarDocumento kitId={id} tipos={[...TIPOS_DOCUMENTO_KIT]} sugerido={k.exige_carta && k.cartas === 0 ? "carta_cessao" : null} />}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Parcelas no Consistem</CardTitle>
            <CardDescription>Ligadas sozinhas pela NF (título 4{k.nota_fiscal}…) quando a sincronização traz o título implantado. O boleto é anexado na parcela, pela Cobrança.</CardDescription>
          </CardHeader>
          <CardContent>
            {(titulos ?? []).length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Ainda não implantada no Consistem.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Título</TableHead><TableHead>Vencimento</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Boleto</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(titulos ?? []).map((t) => {
                    const b = boletoPorTitulo.get(t.id);
                    return (
                      <TableRow key={t.id}>
                        <TableCell>{sessao.acesso.restrito ? t.documento : <Link className="underline" href={`/financeiro/recebiveis/${t.id}`}>{t.documento}</Link>}{t.cedido && <Badge variant="outline" className="ml-1">AKF</Badge>}</TableCell>
                        <TableCell>{formatarData(t.vencimento)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatarMoeda(emCentavos(t.valor))}</TableCell>
                        <TableCell className="text-[13px]">
                          {b ? (b.url ? <a className="underline" href={b.url} target="_blank" rel="noreferrer">{b.nome}</a> : b.nome)
                            : t.forma_pagamento === "transferencia" ? <span className="text-muted-foreground">transferência</span>
                              : <span className="text-muted-foreground">falta</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
