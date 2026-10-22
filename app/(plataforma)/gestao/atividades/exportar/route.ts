// Exportação (Excel) de Central de Gestão > Atividades: os mesmos filtros e a mesma regra de visibilidade da tela
// (RLS de quem exporta). Traz no topo quem emitiu, quando e os critérios.
import { NextResponse, type NextRequest } from "next/server";
import { formatarData, formatarDataHora, hojeEmCuiaba } from "@/lib/nucleo/fila";
import { descreverDuracao, lerFiltrosAtividades, resumirTipos } from "@/lib/nucleo/gestao/atividades";
import { temAcessoAlgumaArea } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import type { LinhaResumo, LinhaTempo } from "../dados";

const LIMITE = 10_000;

export async function GET(request: NextRequest) {
  const sessao = await exigirSessao();
  if (sessao.acesso.restrito || !temAcessoAlgumaArea(sessao.acesso, sessao.areas)) return new NextResponse("Sem acesso.", { status: 403 });
  const supabase = await criarClienteServidor();
  const { data: eu } = await supabase.from("perfis").select("acompanha_equipe").eq("id", sessao.userId).maybeSingle();
  const acompanha = sessao.acesso.adminGeral || Boolean(eu?.acompanha_equipe);
  const f = lerFiltrosAtividades(Object.fromEntries(request.nextUrl.searchParams), hojeEmCuiaba(), sessao.userId, acompanha);

  const [resumo, tempo, regras, modulos] = await Promise.all([
    acompanha && !f.pessoa && !f.ref ? supabase.rpc("atividades_resumo", { p_de: f.de, p_ate: f.ate }) : Promise.resolve(null),
    supabase.rpc("atividades_linha_do_tempo", {
      p_usuario: f.ref ? null : f.pessoa, p_de: f.ref ? null : f.de, p_ate: f.ref ? null : f.ate,
      p_acessos: f.acessos, p_referencia: f.ref, p_modulo: f.modulo,
    }).order("em", { ascending: false }).limit(LIMITE),
    supabase.from("atividade_regras").select("codigo, nome"),
    supabase.from("modulos").select("codigo, nome"),
  ]);
  for (const r of [resumo, tempo]) if (r?.error) return new NextResponse(`Falha ao ler as atividades: ${r.error.message}`, { status: 500 });
  const nomesTipos = new Map(((regras.data ?? []) as { codigo: string; nome: string }[]).map((r) => [r.codigo, r.nome]));
  const nomeModulo = new Map(((modulos.data ?? []) as { codigo: string; nome: string }[]).map((m) => [m.codigo, m.nome]));

  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "Neo Admin — Central de Gestão";
  const cabecalho = (ws: import("exceljs").Worksheet, titulo: string, colunas: string[]) => {
    ws.addRow([`Neo Admin — ${titulo}`]).font = { bold: true, size: 13 };
    ws.addRow([`Emitido em ${formatarDataHora(new Date().toISOString())} por ${sessao.perfil.nome}`]);
    ws.addRow([f.ref ? "Critério: um registro (todas as datas)" : `Período: ${formatarData(f.de)} a ${formatarData(f.ate)}${f.acessos ? "" : " · só ações"}`]);
    ws.addRow(["Não é nota de produtividade: volume e tipo de trabalho variam por área e responsabilidade."]).font = { italic: true };
    ws.addRow([]);
    const cab = ws.addRow(colunas);
    cab.font = { bold: true };
    cab.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } }; });
    ws.views = [{ state: "frozen", ySplit: cab.number }];
    colunas.forEach((_, i) => { ws.getColumn(i + 1).width = i === 0 ? 18 : 26; });
  };

  if (resumo) {
    const ws = wb.addWorksheet("Resumo por pessoa");
    cabecalho(ws, "Resumo por pessoa", ["Pessoa", "Ações", "Dias com atividade", "Principais ações", "Pendências concluídas", "No prazo", "Após o prazo", "Tempo médio até concluir", "Última ação", "Último acesso"]);
    for (const r of (resumo.data ?? []) as LinhaResumo[]) {
      ws.addRow([r.nome, r.acoes, r.dias_com_atividade, resumirTipos(r.por_tipo, nomesTipos, 20), r.concluidas, r.concluidas_no_prazo,
        r.concluidas_apos_prazo, descreverDuracao(r.horas_ate_concluir), formatarDataHora(r.ultima_atividade), formatarDataHora(r.ultimo_acesso)]);
    }
  }
  const ws = wb.addWorksheet("Linha do tempo");
  cabecalho(ws, "Linha do tempo", ["Quando", "Pessoa", "Tipo", "Módulo", "O quê", "Origem do registro"]);
  for (const l of (tempo.data ?? []) as LinhaTempo[]) {
    ws.addRow([formatarDataHora(l.em), l.nome, l.tipo === "acesso" ? `Acessou (${l.vezes}×)` : l.acao,
      l.modulo ? (nomeModulo.get(l.modulo) ?? l.modulo) : "", l.descricao,
      l.tipo === "acesso" ? "acesso" : l.origem === "servico_a_pedido" ? "rotina a pedido" : l.origem === "historico" ? "histórico" : "direto"]);
  }

  const corpo = new Uint8Array(await wb.xlsx.writeBuffer());
  return new NextResponse(corpo, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="atividades-${f.de}-a-${f.ate}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
