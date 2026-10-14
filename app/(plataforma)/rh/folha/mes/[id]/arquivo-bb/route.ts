// Download do arquivo de crédito do BB (FOPAG) da folha aprovada: igual à exportação de hoje (CPF | AG | CONTA | SALÁRIO). Só gestor
// do RH. Cada geração fica registrada no mês (rh_fp_registrar_arquivo_bb); "marcar como paga" exige que tenha sido gerado.
import { NextResponse, type NextRequest } from "next/server";
import { CABECALHO_FOLHA, gerarArquivoBB, linhasBB, nomeArquivoBB } from "@/lib/modulos/rh/arquivo-bb";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerItens, lerMes } from "../../../dados";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessao = await exigirSessao();
  if (!temAcesso(sessao.acesso, "rh", "gestor")) return new NextResponse("Somente gestor do RH gera o arquivo do BB.", { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Mês inválido.", { status: 400 });
  const supabase = await criarClienteServidor();
  const mes = await lerMes(supabase, id);
  if (!mes) return new NextResponse("Mês não encontrado.", { status: 404 });
  if (mes.status !== "aprovada" && mes.status !== "paga") return new NextResponse("O arquivo do BB só sai da folha aprovada.", { status: 409 });
  const r = linhasBB(await lerItens(supabase, id));
  if (!r.ok) return new NextResponse(r.erro, { status: 409 });
  const { error } = await supabase.rpc("rh_fp_registrar_arquivo_bb", { p_id: id });
  if (error) return new NextResponse(error.code === "P0001" ? error.message : "Não foi possível registrar a geração.", { status: 409 });
  const arquivo = await gerarArquivoBB(r.linhas, CABECALHO_FOLHA);
  const nome = nomeArquivoBB(mes.competencia, "FOLHA");
  return new NextResponse(new Blob([arquivo as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      "Cache-Control": "no-store",
    },
  });
}
