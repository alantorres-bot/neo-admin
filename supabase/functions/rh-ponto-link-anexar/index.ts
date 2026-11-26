// Edge Function do RH > Ponto: o líder anexa o atestado pelo link público do formulário (/justificar-ponto/<chave>), sem login
// (decisão de 26/11/2026, 0530). A chave secreta do lote é a autorização: a ocorrência tem de ser do lote dessa chave e o lote
// tem de estar com o líder (enviado/devolvido). O arquivo vai para o mesmo lugar em que o RH anexa (núcleo: bucket e tabela
// `anexos`, tipo 'atestado'), e o RH baixa pela tela do lote. Anexo é prova: não se apaga; para corrigir, anexa outro.
//
// Chamada pela ação de servidor do link (app/justificar-ponto/[chave]/acoes.ts). Corpo multipart: chave, ocorrencia, arquivo.
// verify_jwt = false (o link é anônimo). Service role só aqui dentro.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CABECALHOS = { "Content-Type": "application/json; charset=utf-8" };
const responder = (corpo: Record<string, unknown>, status = 200) => new Response(JSON.stringify(corpo), { status, headers: CABECALHOS });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAVE = /^[0-9a-f]{64}$/;
const LIMITE_BYTES = 10 * 1024 * 1024;
const MAXIMO_POR_OCORRENCIA = 5;
const TIPOS: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };

/** Mesma regra de lib/nucleo/anexos.ts (nomeSeguro): sem acento nem caractere que o Storage rejeita. */
function nomeSeguro(nome: string): string {
  const limpo = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_*\._*/g, ".").replace(/_+/g, "_").replace(/^[._]+|[._]+$/g, "");
  const final = limpo.slice(-120).replace(/^[._]+/, "");
  return final === "" ? "arquivo" : final;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);

  let dados: FormData;
  try {
    dados = await req.formData();
  } catch {
    return responder({ erro: "Envio inválido." }, 400);
  }
  const chave = String(dados.get("chave") ?? "");
  const ocorrencia = String(dados.get("ocorrencia") ?? "");
  const arquivo = dados.get("arquivo");
  if (!CHAVE.test(chave) || !UUID.test(ocorrencia)) return responder({ erro: "Link inválido." }, 400);
  if (!(arquivo instanceof File) || arquivo.size === 0) return responder({ erro: "Escolha o arquivo do atestado." }, 400);
  if (arquivo.size > LIMITE_BYTES) return responder({ erro: "O arquivo passa do limite de 10 MB." }, 400);
  const extensao = arquivo.name.split(".").pop()?.toLowerCase() ?? "";
  if (!TIPOS[extensao]) return responder({ erro: "Envie o atestado em PDF, JPG ou PNG." }, 400);

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: lote } = await banco.from("rh_pt_lotes").select("id, status").eq("chave", chave).maybeSingle();
  if (!lote) return responder({ erro: "Link inválido." }, 404);
  if (!["enviado", "devolvido"].includes(lote.status)) {
    return responder({ erro: "Estas justificativas já foram enviadas ao RH. Entregue o atestado direto ao RH." }, 409);
  }
  const { data: oc } = await banco.from("rh_pt_ocorrencias").select("id").eq("id", ocorrencia).eq("lote_id", lote.id).maybeSingle();
  if (!oc) return responder({ erro: "Ocorrência não encontrada neste link." }, 404);
  const { count } = await banco.from("anexos").select("id", { count: "exact", head: true })
    .eq("referencia_tabela", "rh_pt_ocorrencias").eq("referencia_id", ocorrencia);
  if ((count ?? 0) >= MAXIMO_POR_OCORRENCIA) return responder({ erro: `Já há ${MAXIMO_POR_OCORRENCIA} arquivos nesta ocorrência. Fale com o RH.` }, 409);

  // Mesmo caminho de lib/nucleo/anexos.ts (montarCaminhoAnexo): <modulo>/<tabela>/<id>/<uuid>-<nome>.
  const caminho = `rh.ponto/rh_pt_ocorrencias/${ocorrencia}/${crypto.randomUUID()}-${nomeSeguro(arquivo.name)}`;
  const envio = await banco.storage.from("anexos").upload(caminho, arquivo, { contentType: TIPOS[extensao], upsert: false });
  if (envio.error) return responder({ erro: "Não foi possível enviar o arquivo. Tente novamente." }, 500);
  // Se o registro falhar, o arquivo fica órfão no bucket (mesma regra do enviarAnexo): nunca registro sem arquivo.
  const registro = await banco.from("anexos").insert({
    modulo: "rh.ponto", referencia_tabela: "rh_pt_ocorrencias", referencia_id: ocorrencia,
    arquivo_path: caminho, nome_arquivo: arquivo.name.slice(0, 200), tipo: "atestado", enviado_por: null,
  });
  if (registro.error) return responder({ erro: "Arquivo enviado, mas o registro falhou. Avise o RH." }, 500);
  return responder({ ok: true, nome: arquivo.name });
});
