// Download da planilha do fechamento de comissões (XLSX). Com ?rep=<código>, só a do representante (o relatório que vai
// para ele); sem, uma aba por representante. Exige o módulo de comissões.
import { NextResponse, type NextRequest } from "next/server";
import { gerarPlanilhaComissoes, nomePlanilhaComissoes } from "@/lib/modulos/financeiro/comissoes/planilha";
import { MODULO_COMISSOES } from "@/lib/modulos/financeiro/comissoes/regras";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerFechamento, ROTULO_ORIGEM, rotuloCompetencia } from "../../dados";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessao = await exigirSessao();
  if (!temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_COMISSOES)) return new NextResponse("Sem acesso.", { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Fechamento inválido.", { status: 400 });
  const dados = await lerFechamento(await criarClienteServidor(), id);
  if (!dados) return new NextResponse("Fechamento não encontrado.", { status: 404 });
  const rep = request.nextUrl.searchParams.get("rep");
  const escolhidos = rep ? dados.porRepresentante.filter((x) => x.representante.cod_representante === rep) : dados.porRepresentante;
  if (escolhidos.length === 0) return new NextResponse("Representante sem linhas neste fechamento.", { status: 404 });
  const abas = escolhidos.map(({ representante: r, linhas }) => ({
    nome: r.nome, perc_venda: r.perc_venda, perc_locacao: r.perc_locacao,
    linhas: linhas.filter((l) => l.incluida && l.origem !== "antecipacao").map((l) => ({
      documento: l.cod_titulo ?? "", cliente: l.nome_cliente ?? l.cod_cliente ?? l.observacao ?? "", data_pagamento: l.data_pagamento,
      valor_base: Number(l.valor_base), tipo: l.tipo, percentual: Number(l.percentual), comissao: Number(l.valor_comissao), origem: ROTULO_ORIGEM[l.origem],
    })),
    antecipacoes: linhas.filter((l) => l.incluida && l.origem === "antecipacao").map((l) => ({ descricao: l.observacao ?? "Antecipação", data: l.data_pagamento, valor: Number(l.valor_comissao) })),
  }));
  const arquivo = await gerarPlanilhaComissoes(rotuloCompetencia(dados.fechamento.competencia), abas);
  const nome = nomePlanilhaComissoes(dados.fechamento.competencia, rep ? escolhidos[0].representante.nome : undefined);
  return new NextResponse(new Blob([arquivo as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome.normalize("NFD").replace(/[̀-ͯ]/g, "")}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      "Cache-Control": "no-store",
    },
  });
}
