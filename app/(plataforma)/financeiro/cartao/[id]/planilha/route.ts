// Download da planilha de conciliação (XLSX) da fatura. Exige login e acesso ao Financeiro; a conciliação é calculada na hora.
import { NextResponse, type NextRequest } from "next/server";
import { nomeDaPlanilha, gerarPlanilha } from "@/lib/modulos/financeiro/cartao/planilha";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { conciliacaoDaRequisicao } from "../../dados";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "financeiro")) return new NextResponse("Sem acesso.", { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Fatura inválida.", { status: 400 });
  const c = await conciliacaoDaRequisicao(id);
  if (!c) return new NextResponse("Fatura não encontrada.", { status: 404 });
  const arquivo = await gerarPlanilha(c.resultado);
  const nome = nomeDaPlanilha(c.resultado);
  return new NextResponse(new Blob([arquivo as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome.normalize("NFD").replace(/[̀-ͯ]/g, "")}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      "Cache-Control": "no-store",
    },
  });
}
