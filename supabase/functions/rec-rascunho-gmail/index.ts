// Edge Function do módulo Financeiro/Recebíveis: cria o RASCUNHO do e-mail do boleto no Gmail, com os boletos em anexo.
// Nunca envia: só `drafts.create` (escopo gmail.compose). Quem confere e envia é uma pessoa, no Gmail.
//
// Chamada pela ação de servidor da ficha da NF, depois de gravar a mensagem como `rascunho` com a sessão do usuário.
// Corpo (JSON): { mensagem_id, titulo_ids[], modo? }
// modo "cobranca": e-mail da régua de cobrança; anexa o boleto de cada parcela que tiver um, mas não exige (padrão: exige).
// modo "dados": e-mail com os dados de pagamento por transferência; não anexa nada e não exige boleto.
//
// Quem pode chamar: usuário logado, operador (ou acima) do Financeiro, e que seja o autor da mensagem.
// Segredos (Supabase > Edge Functions > Secrets): GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN,
// GMAIL_REMETENTE (caixa de quem autorizou; o rascunho aparece nela). Obtenha-os com scripts/gmail-autorizar.mjs.
//
// Deploy: npx supabase functions deploy rec-rascunho-gmail
import { createClient } from "jsr:@supabase/supabase-js@2";
import { criarRascunho, GmailErro, lerCredenciais, montarMime, obterAccessToken, type AnexoEmail } from "../_shared/gmail.ts";

const MODULO = "financeiro.recebiveis";
const LIMITE_ANEXOS_BYTES = 20 * 1024 * 1024;
const MAX_TITULOS = 50;

const CABECALHOS = { "Content-Type": "application/json; charset=utf-8" };
const responder = (corpo: Record<string, unknown>, status = 200) => new Response(JSON.stringify(corpo), { status, headers: CABECALHOS });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tipoDoArquivo(nome: string): string {
  const ext = nome.toLowerCase().split(".").pop() ?? "";
  return ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" } as Record<string, string>)[ext] ?? "application/octet-stream";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  const autorizacao = req.headers.get("Authorization");
  if (!autorizacao) return responder({ erro: "Não autenticado." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const chaveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);

  // 1) Quem chama: operador do Financeiro logado.
  const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
  const { data: quem, error: erroUsuario } = await comoUsuario.auth.getUser();
  if (erroUsuario || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
  const { data: permitido, error: erroPermissao } = await comoUsuario.rpc("tem_acesso_modulo", { p_modulo: MODULO, p_minimo: "operador" });
  if (erroPermissao || permitido !== true) return responder({ erro: "Somente operador do Financeiro ou acima cria rascunhos de e-mail." }, 403);
  const usuarioId = quem.user.id;

  let corpo: { mensagem_id?: unknown; titulo_ids?: unknown; modo?: unknown };
  try {
    corpo = await req.json();
  } catch {
    return responder({ erro: "Corpo inválido." }, 400);
  }
  const mensagemId = String(corpo.mensagem_id ?? "");
  const cobranca = corpo.modo === "cobranca";
  const dadosPagamento = corpo.modo === "dados";
  const tituloIds = Array.isArray(corpo.titulo_ids) ? [...new Set(corpo.titulo_ids.map(String))] : [];
  if (!UUID.test(mensagemId) || tituloIds.length === 0 || tituloIds.length > MAX_TITULOS || !tituloIds.every((i) => UUID.test(i))) {
    return responder({ erro: "Mensagem ou parcelas inválidas." }, 400);
  }

  // 2) Credenciais do Gmail (antes de qualquer trabalho): faltando, diz só os NOMES.
  const cred = lerCredenciais((n) => Deno.env.get(n));
  if (!cred.ok) {
    return responder({ erro: `O Gmail ainda não está configurado neste projeto (faltam: ${cred.faltando.join(", ")}). Rode scripts/gmail-autorizar.mjs.` }, 500);
  }

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });

  // 3) A mensagem: do usuário, e-mail, ainda rascunho e sem rascunho já criado.
  const { data: mensagem } = await banco.from("mensagens")
    .select("id, modulo, canal, status, destinatario, assunto, corpo, contraparte_id, criado_por, id_externo").eq("id", mensagemId).maybeSingle();
  if (!mensagem || mensagem.modulo !== MODULO || mensagem.canal !== "email") return responder({ erro: "Mensagem não encontrada." }, 404);
  if (mensagem.criado_por !== usuarioId) return responder({ erro: "Só quem criou a mensagem gera o rascunho." }, 403);
  if (mensagem.status !== "rascunho" || mensagem.id_externo) return responder({ erro: "Esta mensagem já tem rascunho ou já foi encerrada." }, 409);

  // 4) As parcelas: do mesmo cliente da mensagem, cada uma com boleto anexado.
  const { data: titulos } = await banco.from("rec_titulos").select("id, contraparte_id").in("id", tituloIds);
  if (!titulos || titulos.length !== tituloIds.length || titulos.some((t) => t.contraparte_id !== mensagem.contraparte_id)) {
    return responder({ erro: "As parcelas não pertencem ao cliente da mensagem." }, 400);
  }
  const { data: anexos } = await banco.from("anexos").select("referencia_id, arquivo_path, nome_arquivo, enviado_em")
    .eq("modulo", MODULO).eq("referencia_tabela", "rec_titulos").eq("tipo", "boleto").in("referencia_id", tituloIds).order("enviado_em", { ascending: false });
  const maisRecente = new Map<string, { arquivo_path: string; nome_arquivo: string }>();
  for (const a of anexos ?? []) if (!maisRecente.has(a.referencia_id as string)) maisRecente.set(a.referencia_id as string, a as { arquivo_path: string; nome_arquivo: string });
  if (!cobranca && !dadosPagamento && tituloIds.some((i) => !maisRecente.has(i))) return responder({ erro: "Anexe o boleto de cada parcela antes de criar o rascunho." }, 400);

  const arquivos: AnexoEmail[] = [];
  let total = 0;
  for (const id of dadosPagamento ? [] : tituloIds) {
    const a = maisRecente.get(id);
    if (!a) continue; // só na cobrança: parcela sem boleto anexado
    const { data: blob, error: erroDownload } = await banco.storage.from("anexos").download(a.arquivo_path);
    if (erroDownload || !blob) return responder({ erro: "Não foi possível ler um dos boletos anexados." }, 500);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    total += bytes.length;
    if (total > LIMITE_ANEXOS_BYTES) return responder({ erro: "Os boletos somam mais de 20 MB; crie o rascunho com menos parcelas." }, 400);
    arquivos.push({ nome: a.nome_arquivo, tipo: tipoDoArquivo(a.nome_arquivo), bytes });
  }

  // 5) Rascunho no Gmail.
  const buscar = (u: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }) => fetch(u, init as RequestInit);
  let rascunho;
  try {
    const mime = montarMime({ de: cred.credenciais.remetente, para: mensagem.destinatario as string, assunto: (mensagem.assunto as string | null) ?? "", corpo: mensagem.corpo as string, anexos: arquivos });
    const acesso = await obterAccessToken(buscar, cred.credenciais);
    rascunho = await criarRascunho(buscar, acesso, mime);
  } catch (e) {
    const texto = e instanceof GmailErro ? e.message : "Falha inesperada ao criar o rascunho.";
    await banco.from("mensagens").update({ erro: texto }).eq("id", mensagemId);
    return responder({ erro: texto }, e instanceof GmailErro && e.status && e.status < 500 ? 400 : 502);
  }

  // 6) Registro: o rascunho na mensagem, as parcelas ligadas a ela e uma interação por parcela (histórico).
  const { error: erroMensagem } = await banco.from("mensagens").update({ id_externo: rascunho.rascunhoId, erro: null }).eq("id", mensagemId);
  const { error: erroLigacao } = await banco.from("rec_mensagem_titulos").upsert(tituloIds.map((t) => ({ mensagem_id: mensagemId, titulo_id: t })), { onConflict: "mensagem_id,titulo_id", ignoreDuplicates: true });
  const { error: erroInteracao } = await banco.from("interacoes").insert(tituloIds.map((t) => ({
    modulo: MODULO, contraparte_id: mensagem.contraparte_id, referencia_tabela: "rec_titulos", referencia_id: t, canal: "email", tipo: "rascunho_gmail",
    descricao: `Rascunho do e-mail ${cobranca ? "de cobrança" : dadosPagamento ? "de dados para pagamento" : "do boleto"} criado no Gmail (${mensagem.destinatario}), com ${arquivos.length} ${arquivos.length === 1 ? "anexo" : "anexos"}. Aguardando conferência e envio.`,
    usuario_id: usuarioId,
  })));
  const aviso = erroMensagem || erroLigacao || erroInteracao ? "O rascunho foi criado, mas parte do registro no Neo Admin falhou." : undefined;

  return responder({ ok: true, url: rascunho.url, rascunhoId: rascunho.rascunhoId, anexos: arquivos.length, aviso });
});
