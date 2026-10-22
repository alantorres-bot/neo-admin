// Download autorizado: confere sessão, módulo e o registro (RLS por empresa); gera URL assinada de 60 segundos e registra o acesso.
// Nunca há link público permanente: o bucket 'fiscal' é privado.
import { NextResponse } from "next/server";
import { MODULO_CREDITOS } from "@/lib/modulos/fiscal/creditos/modulo";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessao = await exigirSessao();
  if (!temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_CREDITOS)) return new NextResponse("Sem acesso.", { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Documento inválido.", { status: 400 });
  const supabase = await criarClienteServidor();
  const { data: doc } = await supabase.from("fis_documentos").select("id, arquivo_path, nome_arquivo, ficticio, empresa_id").eq("id", id).maybeSingle();
  if (!doc) return new NextResponse("Documento não encontrado.", { status: 404 });
  if (!doc.arquivo_path) return new NextResponse("Documento fictício de demonstração: não há arquivo.", { status: 404 });
  const { data, error } = await supabase.storage.from("fiscal").createSignedUrl(doc.arquivo_path, 60, { download: doc.nome_arquivo ?? true });
  if (error || !data) {
    console.warn(`[fiscal] download ${id}: ${error?.message.slice(0, 120)}`);
    return new NextResponse("Arquivo indisponível no armazenamento.", { status: 404 });
  }
  console.info(`[fiscal] download documento=${id} usuario=${sessao.userId}`);
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
