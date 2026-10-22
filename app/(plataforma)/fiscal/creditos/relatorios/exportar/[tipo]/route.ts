// Exportação (Excel) dos relatórios do Fiscal Control. Respeita a RLS do usuário (empresas do escopo) e os filtros da URL;
// cada planilha traz data/hora de emissão, quem emitiu, período e critérios.
import { NextResponse, type NextRequest } from "next/server";
import { agregarPorChave, type LinhaBanco } from "@/lib/modulos/fiscal/creditos/apuracao";
import { centavos, competencia, competenciasDoAno, dataHora } from "@/lib/modulos/fiscal/creditos/formatos";
import { CAMPOS, type TipoImportacao } from "@/lib/modulos/fiscal/creditos/importacao";
import {
  MODULO_CREDITOS, REGRAS, ROTULO_DISPONIBILIDADE, ROTULO_FONTE, ROTULO_STATUS_DIVERGENCIA, ROTULO_STATUS_MOV, ROTULO_STATUS_OBRIGACAO, ROTULO_VALIDACAO,
  type Disponibilidade, type StatusObrigacao, type Validacao,
} from "@/lib/modulos/fiscal/creditos/modulo";
import { emReais, gerarPlanilha, type Celula, type ColunaPlanilha, type Relatorio } from "@/lib/modulos/fiscal/creditos/planilha";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerConsolidado } from "../../../consolidado/dados";
import { lerCadastros, lerFiltros, nomes } from "../../../dados";

const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : "");

export async function GET(request: NextRequest, { params }: { params: Promise<{ tipo: string }> }) {
  const sessao = await exigirSessao();
  if (!temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_CREDITOS)) return new NextResponse("Sem acesso.", { status: 403 });
  const { tipo } = await params;
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const hoje = new Date();
  const f = lerFiltros(sp, Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba", year: "numeric" }).format(hoje)));
  const supabase = await criarClienteServidor();
  const cad = await lerCadastros();
  const n = nomes(cad);
  const criterios = [
    `Empresa: ${f.empresa ? n.empresa.get(f.empresa) : "todas do escopo do usuário"}`,
    `Estabelecimento: ${f.estab ? n.estab.get(f.estab) : "todos"} · Tributo: ${f.tributo ? n.tributo.get(f.tributo) : "todos"}`,
  ];
  const base = { emitidoPor: sessao.perfil.nome, emitidoEm: dataHora(hoje.toISOString()) };
  const periodo = `Período: ${f.mes ? `${String(f.mes).padStart(2, "0")}/${f.ano}` : `exercício ${f.ano}`}`;
  let abas: Relatorio[] = [];
  let nome = `fiscal-${tipo}`;

  const aplicar = <Q extends { eq: (c: string, v: string) => Q }>(q: Q) => {
    let r = q;
    if (f.empresa) r = r.eq("empresa_id", f.empresa);
    if (f.estab) r = r.eq("estabelecimento_id", f.estab);
    if (f.tributo) r = r.eq("tributo_id", f.tributo);
    return r;
  };

  if (tipo === "modelo-creditos" || tipo === "modelo-movimentos") {
    const t = tipo.replace("modelo-", "") as TipoImportacao;
    abas = [{
      titulo: `Modelo ${t === "creditos" ? "créditos" : "movimentações"}`, ...base,
      criterios: ["Preencha a partir da linha abaixo do cabeçalho; apague a linha de exemplo. Campos com * são obrigatórios.", "Valores: 1.234,56 · Datas: dd/mm/aaaa · Competência: MM/AAAA. Exemplo FICTÍCIO."],
      colunas: CAMPOS[t].map((c) => ({ titulo: `${c.titulo}${c.obrigatorio ? " *" : ""}` })), linhas: [CAMPOS[t].map((c) => c.exemplo)],
    }];
    // O modelo precisa do cabeçalho na 1ª linha para ser reimportado: aba simples sem o bloco de emissão.
    const { Workbook } = await import("exceljs");
    const wb = new Workbook();
    const ws = wb.addWorksheet("Importar");
    ws.addRow(CAMPOS[t].map((c) => c.titulo)).font = { bold: true };
    ws.addRow(CAMPOS[t].map((c) => c.exemplo));
    CAMPOS[t].forEach((_, i) => { ws.getColumn(i + 1).width = 24; });
    const inst = wb.addWorksheet("Instruções");
    for (const l of [...abas[0].criterios, "", "Campo | Obrigatório | Formato | Exemplo", ...CAMPOS[t].map((c) => `${c.titulo} | ${c.obrigatorio ? "sim" : "não"} | ${c.formato} | ${c.exemplo}`)]) inst.addRow([l]);
    inst.getColumn(1).width = 110;
    return arquivo(new Uint8Array(await wb.xlsx.writeBuffer()), `modelo-importacao-${t}.xlsx`);
  }

  if (tipo === "creditos") {
    let q = aplicar(supabase.from("fis_creditos_saldos").select("*").eq("arquivado", false).order("codigo").limit(20000));
    if (f.validacao) q = q.eq("validacao", f.validacao);
    if (sp.disponibilidade) q = q.eq("disponibilidade", sp.disponibilidade);
    const { data } = await q;
    const cols: ColunaPlanilha[] = [{ titulo: "Código" }, { titulo: "Empresa" }, { titulo: "Estabelecimento" }, { titulo: "Tributo", largura: 10 }, { titulo: "Categoria", largura: 34 },
      { titulo: "Origem" }, { titulo: "Competência origem", largura: 12 }, { titulo: "Descrição", largura: 40 }, { titulo: "Processo" }, { titulo: "Valor original", tipo: "moeda" },
      { titulo: "Valor reconhecido", tipo: "moeda" }, { titulo: "Utilizado", tipo: "moeda" }, { titulo: "Compensado", tipo: "moeda" }, { titulo: "Ressarcido/baixado", tipo: "moeda" },
      { titulo: "Saldo", tipo: "moeda" }, { titulo: "Disponível", tipo: "moeda" }, { titulo: "Validação" }, { titulo: "Disponibilidade" }, { titulo: "Prazo aproveitamento", tipo: "data" }, { titulo: "Fictício", largura: 8 }];
    const linhas: Celula[][] = (data ?? []).map((c) => [c.codigo, n.empresa.get(c.empresa_id) ?? "", n.estab.get(c.estabelecimento_id) ?? "", n.tributo.get(c.tributo_id) ?? "", n.categoria.get(c.categoria_id) ?? "",
      n.origem.get(c.origem) ?? c.origem, competencia(c.competencia_origem), c.descricao, c.numero_processo, emReais(centavos(c.valor_original)),
      c.valor_reconhecido === null ? null : emReais(centavos(c.valor_reconhecido)), emReais(centavos(c.utilizado)), emReais(centavos(c.compensado)), emReais(centavos(c.baixado)),
      emReais(centavos(c.saldo)), emReais(centavos(c.saldo_disponivel)), ROTULO_VALIDACAO[c.validacao as Validacao], ROTULO_DISPONIBILIDADE[c.disponibilidade as Disponibilidade], c.data_limite_aproveitamento, c.ficticio ? "sim" : ""]);
    const soma = (i: number) => emReais(linhas.reduce((s, l) => s + Math.round(Number(l[i] ?? 0) * 100), 0));
    abas = [{ titulo: "Créditos", ...base, criterios: [...criterios, `Situação: ${f.validacao ? ROTULO_VALIDACAO[f.validacao as Validacao] : "todas"} · posição atual`], colunas: cols, linhas,
      totais: ["Total", null, null, null, null, null, null, null, null, soma(9), null, soma(11), soma(12), soma(13), soma(14), soma(15)],
      avisos: (data ?? []).some((c) => c.ficticio) ? ["Contém dados FICTÍCIOS de demonstração."] : [] }];
  } else if (tipo === "movimentos") {
    let q = aplicar(supabase.from("fis_movimentos").select("numero, credito_id, estabelecimento_id, tributo_id, tipo, valor_assinado, data, competencia, descricao, protocolo, processo, documento_ref, status, estornado, registrado_por, registrado_em, credito:fis_creditos(codigo)")
      .gte("competencia", `${f.ano}-01-01`).lte("competencia", `${f.ano}-12-01`).order("competencia").order("numero").limit(50000));
    if (f.mes) q = q.eq("competencia", `${f.ano}-${String(f.mes).padStart(2, "0")}-01`);
    if (typeof sp.tipo === "string" && sp.tipo) q = q.eq("tipo", sp.tipo);
    const { data } = await q;
    const um = <T,>(v: T | T[] | null) => (Array.isArray(v) ? v[0] ?? null : v);
    abas = [{ titulo: "Movimentações", ...base, criterios: [periodo, ...criterios], colunas: [
      { titulo: "Nº", tipo: "numero", largura: 8 }, { titulo: "Crédito" }, { titulo: "Estabelecimento" }, { titulo: "Tributo", largura: 10 }, { titulo: "Competência", largura: 12 }, { titulo: "Data", tipo: "data" },
      { titulo: "Tipo", largura: 30 }, { titulo: "Valor (efeito)", tipo: "moeda" }, { titulo: "Descrição", largura: 44 }, { titulo: "Protocolo" }, { titulo: "Processo" }, { titulo: "Documento" },
      { titulo: "Situação" }, { titulo: "Registrado por" }, { titulo: "Registrado em" },
    ], linhas: (data ?? []).map((m) => [m.numero, um(m.credito as unknown as { codigo: string } | null)?.codigo ?? "", n.estab.get(m.estabelecimento_id) ?? "", n.tributo.get(m.tributo_id) ?? "",
      competencia(m.competencia), m.data, n.tipoMov.get(m.tipo) ?? m.tipo, emReais(centavos(m.valor_assinado)), m.descricao, m.protocolo, m.processo, m.documento_ref,
      m.estornado ? "Estornado" : ROTULO_STATUS_MOV[m.status], m.registrado_por ? n.usuario.get(m.registrado_por) ?? "" : "sistema", dataHora(m.registrado_em)]) }];
  } else if (tipo === "apuracao") {
    const estab = uuid(sp.estab ?? null), trib = uuid(sp.tributo ?? null);
    const meses = competenciasDoAno(f.ano);
    const { data } = await supabase.rpc("fis_apuracao", { p_inicio: meses[0], p_fim: meses[11], p_empresa: f.empresa || null, p_estabelecimento: estab || null, p_tributo: trib || null });
    const { data: pers } = await supabase.from("fis_periodos").select("estabelecimento_id, tributo_id, competencia, status, saldo_oficial, fechado_em").gte("competencia", meses[0]).lte("competencia", meses[11]);
    const per = new Map((pers ?? []).map((p) => [`${p.estabelecimento_id}|${p.tributo_id}|${p.competencia}`, p]));
    const ag = agregarPorChave((data ?? []) as LinhaBanco[]);
    abas = [{ titulo: "Apuração mensal", ...base, criterios: [`Exercício ${f.ano}`, ...criterios], colunas: [
      { titulo: "Estabelecimento" }, { titulo: "Tributo", largura: 10 }, { titulo: "Competência", largura: 12 }, { titulo: "Saldo inicial", tipo: "moeda" }, { titulo: "Implantado", tipo: "moeda" },
      { titulo: "Gerado", tipo: "moeda" }, { titulo: "Reconhecido", tipo: "moeda" }, { titulo: "Ajustes (+)", tipo: "moeda" }, { titulo: "Ajustes (−)", tipo: "moeda" }, { titulo: "Utilizado", tipo: "moeda" },
      { titulo: "Compensado", tipo: "moeda" }, { titulo: "Ressarcido/baixado", tipo: "moeda" }, { titulo: "Transf. recebida", tipo: "moeda" }, { titulo: "Transf. enviada", tipo: "moeda" },
      { titulo: "Saldo final", tipo: "moeda" }, { titulo: "Saldo oficial", tipo: "moeda" }, { titulo: "Situação" },
    ], linhas: ag.map((l) => {
      const p = per.get(l.chave);
      return [n.estab.get(l.estabelecimentoId) ?? "", n.tributo.get(l.tributoId) ?? "", competencia(l.competencia), ...[l.saldoInicial, l.implantado, l.gerado, l.reconhecido, l.ajustesPositivos, l.ajustesNegativos,
        l.utilizado, l.compensado, l.baixado, l.transferidoEntrada, l.transferidoSaida, l.saldoFinal].map(emReais), p?.saldo_oficial != null ? emReais(centavos(p.saldo_oficial)) : null,
        p?.status === "fechado" ? `Fechada em ${dataHora(p.fechado_em)}` : p?.status === "em_revisao" ? "Em revisão" : "Aberta"];
    }) }];
    nome = `fiscal-apuracao-${f.ano}`;
  } else if (tipo === "consolidado") {
    const r = await lerConsolidado(supabase, f);
    const cols: ColunaPlanilha[] = [{ titulo: "Tributo" }, ...["Saldo inicial do exercício", "Implantado no ano", "Gerados", "Reconhecidos", "Ajustes (líquido)", "Utilizações", "Compensações", "Ressarcimentos e baixas", "Transferências (líquido)", "Saldo final", "Transportado p/ próximo ano", "Pendentes de validação"].map((t) => ({ titulo: t, tipo: "moeda" as const })), { titulo: "Doc. incompleta", tipo: "numero" }, { titulo: "Divergências abertas", tipo: "numero" }];
    const linha = (rot: string, c: NonNullable<typeof r.total>, e?: ReturnType<typeof r.extras>): Celula[] => [rot, ...[c.saldoInicial, c.implantadoNoAno, c.gerado, c.reconhecido, c.ajustesPositivos - c.ajustesNegativos, c.utilizado, c.compensado, c.baixado,
      c.transferidoEntrada - c.transferidoSaida, c.saldoFinal, c.saldoFinal].map(emReais), e ? emReais(e.pendenteValidacao) : null, e?.docIncompleta ?? null, e?.divergencias ?? null];
    abas = [
      { titulo: `Consolidado ${f.ano}`, ...base, criterios: [`Exercício ${f.ano} (saldo final = transportado para ${f.ano + 1})`, ...criterios],
        colunas: cols, linhas: r.porTributo.filter((g) => g.atual).map((g) => linha(n.tributo.get(g.chave) ?? "", g.atual!, r.extras(g.chave))), totais: r.total ? linha("Total", r.total) : undefined },
      { titulo: "Por estabelecimento", ...base, criterios: [`Exercício ${f.ano}`, ...criterios], colunas: [{ titulo: "Estabelecimento" }, ...cols.slice(0, 12)],
        linhas: r.porEstab.filter((g) => g.atual).map((g) => { const [e, t] = g.chave.split("|"); return [n.estab.get(e) ?? "", ...linha(n.tributo.get(t) ?? "", g.atual!).slice(0, 12)]; }) },
    ];
    nome = `fiscal-consolidado-${f.ano}`;
  } else if (tipo === "obrigacoes") {
    let q = aplicar(supabase.from("fis_obrigacoes").select("*").gte("competencia", `${f.ano}-01-01`).lte("competencia", `${f.ano}-12-01`).order("competencia").limit(20000));
    if (f.mes) q = q.eq("competencia", `${f.ano}-${String(f.mes).padStart(2, "0")}-01`);
    if (f.status) q = q.eq("status", f.status);
    const { data } = await q;
    abas = [{ titulo: "Obrigações", ...base, criterios: [periodo, ...criterios, `Situação: ${f.status ? ROTULO_STATUS_OBRIGACAO[f.status as StatusObrigacao] : "todas"}`], colunas: [
      { titulo: "Obrigação", largura: 30 }, { titulo: "Estabelecimento" }, { titulo: "Competência", largura: 12 }, { titulo: "Vencimento", tipo: "data" }, { titulo: "Vencimento confirmado", largura: 12 },
      { titulo: "Situação" }, { titulo: "Responsável" }, { titulo: "Contador" }, { titulo: "Transmissão", tipo: "data" }, { titulo: "Recibo/protocolo" }, { titulo: "Observações", largura: 40 },
    ], linhas: (data ?? []).map((o) => [n.tipoObr.get(o.tipo_id) ?? "", n.estab.get(o.estabelecimento_id) ?? "", competencia(o.competencia), o.vencimento, o.vencimento_confirmado ? "sim" : "a confirmar",
      ROTULO_STATUS_OBRIGACAO[o.status as StatusObrigacao], o.responsavel_id ? n.usuario.get(o.responsavel_id) ?? "" : "", o.contador_responsavel, o.data_transmissao, o.numero_recibo, o.observacoes]) }];
  } else if (tipo === "conciliacao") {
    const [{ data: alertas }, { data: divs }] = await Promise.all([
      supabase.rpc("fis_verificar", { p_empresa: f.empresa || null, p_ano: f.ano }),
      aplicar(supabase.from("fis_divergencias").select("*").order("numero").limit(20000)),
    ]);
    type A = { regra: string; severidade: string; titulo: string; descricao: string; competencia: string | null; valor: string | null; estabelecimento_id: string | null; tributo_id: string | null };
    abas = [
      { titulo: "Alertas", ...base, criterios: [`Exercício ${f.ano}`, ...criterios], colunas: [{ titulo: "Regra", largura: 30 }, { titulo: "Severidade" }, { titulo: "Descrição", largura: 80 }, { titulo: "Competência" }, { titulo: "Valor", tipo: "moeda" }],
        linhas: ((alertas ?? []) as A[]).filter((a) => (!f.estab || a.estabelecimento_id === f.estab) && (!f.tributo || a.tributo_id === f.tributo))
          .map((a) => [`${a.regra} — ${REGRAS[a.regra]?.nome ?? a.titulo}`, a.severidade, a.descricao, competencia(a.competencia), a.valor === null ? null : emReais(centavos(a.valor))]) },
      { titulo: "Divergências", ...base, criterios, colunas: [{ titulo: "Nº", tipo: "numero" }, { titulo: "Estabelecimento" }, { titulo: "Tributo" }, { titulo: "Competência" }, { titulo: "Fonte" },
        { titulo: "Interno", tipo: "moeda" }, { titulo: "Externo", tipo: "moeda" }, { titulo: "Diferença", tipo: "moeda" }, { titulo: "Motivo", largura: 50 }, { titulo: "Providência", largura: 30 },
        { titulo: "Responsável" }, { titulo: "Prazo", tipo: "data" }, { titulo: "Situação" }, { titulo: "Solução", largura: 40 }],
        linhas: (divs ?? []).map((d) => [d.numero, d.estabelecimento_id ? n.estab.get(d.estabelecimento_id) ?? "" : "", d.tributo_id ? n.tributo.get(d.tributo_id) ?? "" : "", competencia(d.competencia),
          d.fonte_comparada ? ROTULO_FONTE[d.fonte_comparada] : "", d.valor_interno === null ? null : emReais(centavos(d.valor_interno)), d.valor_externo === null ? null : emReais(centavos(d.valor_externo)),
          emReais(centavos(d.valor_diferenca)), d.motivo, d.providencia, d.responsavel_id ? n.usuario.get(d.responsavel_id) ?? "" : "", d.prazo_interno, ROTULO_STATUS_DIVERGENCIA[d.status], d.resolucao]) },
    ];
  } else {
    return new NextResponse("Relatório desconhecido.", { status: 404 });
  }
  return arquivo(await gerarPlanilha(abas), `${nome}-${hoje.toISOString().slice(0, 10)}.xlsx`);
}

function arquivo(bytes: Uint8Array, nome: string) {
  return new NextResponse(new Blob([bytes as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}
