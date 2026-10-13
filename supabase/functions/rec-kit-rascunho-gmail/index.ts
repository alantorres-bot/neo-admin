// Edge Function do Faturamento Filial (Fase C): cria, no Gmail de QUEM CHAMA (ex.: a Melina), o RASCUNHO do e-mail ao
// cliente com a nota fatura, o demonstrativo, o comodato, o boleto de cada parcela e, se houver, a carta de cessão.
// Nunca envia: só drafts.create (gmail.compose). A pessoa confere e envia no Gmail; depois marca "Enviado ao cliente".
//
// Chamada pela ação de servidor da ficha do kit, depois de gravar a mensagem como `rascunho` com a sessão do usuário.
// Corpo (JSON): { mensagem_id, kit_id, modo? }
//   modo "completo" (padrão): kit pronto, todos os documentos e os boletos.
//   modo "nota": antes do boleto (kit recebida/implantada) — nota fatura, demonstrativos, comodato; grava a conversa no kit.
//   modo "boleto": kit pronto com a nota já enviada — só os boletos (e a carta de cessão), como resposta na mesma conversa.
// Quem pode: operador do módulo financeiro.filial (inclui o usuário restrito à unidade), autor da mensagem, com o Gmail
// conectado (nucleo-gmail-conectar). Segredos: GMAIL_WEB_CLIENT_ID, GMAIL_WEB_CLIENT_SECRET.
// Deploy: npx supabase functions deploy rec-kit-rascunho-gmail --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import { criarRascunho, GmailErro, montarMime, obterAccessToken, type AnexoEmail } from "../_shared/gmail.ts";

const MODULO = "financeiro.filial";
const LIMITE_ANEXOS_BYTES = 20 * 1024 * 1024;
const TIPOS_KIT = ["nota_fatura", "demonstrativo", "comodato", "carta_cessao"];
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
  const clientId = Deno.env.get("GMAIL_WEB_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GMAIL_WEB_CLIENT_SECRET") ?? "";
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);
  if (!clientId || !clientSecret) return responder({ erro: "O Gmail por usuário ainda não está configurado neste projeto." }, 500);

  // 1) Quem chama: operador do Faturamento Filial.
  const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
  const { data: quem, error: erroUsuario } = await comoUsuario.auth.getUser();
  if (erroUsuario || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
  const { data: permitido } = await comoUsuario.rpc("tem_acesso_modulo", { p_modulo: MODULO, p_minimo: "operador" });
  if (permitido !== true) return responder({ erro: "Somente operador do Faturamento Filial cria este rascunho." }, 403);
  const usuarioId = quem.user.id;

  let corpo: { mensagem_id?: unknown; kit_id?: unknown; modo?: unknown };
  try {
    corpo = await req.json();
  } catch {
    return responder({ erro: "Corpo inválido." }, 400);
  }
  const mensagemId = String(corpo.mensagem_id ?? "");
  const kitId = String(corpo.kit_id ?? "");
  const modo = corpo.modo === "nota" || corpo.modo === "boleto" ? corpo.modo : "completo";
  if (!UUID.test(mensagemId) || !UUID.test(kitId)) return responder({ erro: "Mensagem ou kit inválido." }, 400);

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });

  // 2) O Gmail de quem chama.
  const { data: conta } = await banco.rpc("gmail_refresh_token", { p_perfil: usuarioId });
  const c = conta as { email: string; refresh_token: string } | null;
  if (!c?.refresh_token) return responder({ erro: "Conecte o seu Gmail antes (botão \"Conectar meu Gmail\")." }, 409);

  // 3) Mensagem (do usuário, rascunho, sem rascunho criado) e kit (pronto).
  const { data: mensagem } = await banco.from("mensagens")
    .select("id, modulo, canal, status, destinatario, cc, assunto, corpo, criado_por, id_externo, contraparte_id").eq("id", mensagemId).maybeSingle();
  if (!mensagem || mensagem.modulo !== MODULO || mensagem.canal !== "email") return responder({ erro: "Mensagem não encontrada." }, 404);
  if (mensagem.criado_por !== usuarioId) return responder({ erro: "Só quem criou a mensagem gera o rascunho." }, 403);
  if (mensagem.status !== "rascunho" || mensagem.id_externo) return responder({ erro: "Esta mensagem já tem rascunho." }, 409);
  const { data: kit } = await banco.from("rec_kits")
    .select("id, nota_fiscal, estagio, nota_enviada_em, gmail_thread_id, email_message_id").eq("id", kitId).maybeSingle();
  if (!kit) return responder({ erro: "Kit não encontrado." }, 404);
  if (modo === "nota" && !["recebida", "implantada"].includes(kit.estagio as string)) return responder({ erro: "O envio antecipado vale só antes do boleto." }, 409);
  if (modo === "nota" && kit.nota_enviada_em) return responder({ erro: "A nota desta NF já foi enviada ao cliente." }, 409);
  if (modo !== "nota" && kit.estagio !== "pronta") return responder({ erro: "O kit ainda não está pronto para envio." }, 409);
  if (modo === "boleto" && !kit.nota_enviada_em) return responder({ erro: "A nota ainda não foi enviada: use o envio completo." }, 409);

  // 4) Anexos: documentos do kit (todos, na ordem em que foram enviados) e o boleto mais recente de cada parcela.
  const { data: docs } = await banco.from("anexos").select("tipo, arquivo_path, nome_arquivo, enviado_em")
    .eq("referencia_tabela", "rec_kits").eq("referencia_id", kitId).in("tipo", TIPOS_KIT).order("enviado_em");
  const { data: ligacoes } = await banco.from("rec_kit_titulos").select("titulo_id, rec_titulos(estagio)").eq("kit_id", kitId);
  const tituloIds = (ligacoes ?? [])
    .filter((l) => !["cancelado", "renegociado"].includes(((Array.isArray(l.rec_titulos) ? l.rec_titulos[0] : l.rec_titulos) as { estagio?: string } | null)?.estagio ?? ""))
    .map((l) => l.titulo_id as string);
  const { data: boletos } = tituloIds.length
    ? await banco.from("anexos").select("referencia_id, arquivo_path, nome_arquivo, enviado_em")
      .eq("referencia_tabela", "rec_titulos").eq("tipo", "boleto").in("referencia_id", tituloIds).order("enviado_em", { ascending: false })
    : { data: [] };
  const boletoDe = new Map<string, { arquivo_path: string; nome_arquivo: string }>();
  for (const b of boletos ?? []) if (!boletoDe.has(b.referencia_id as string)) boletoDe.set(b.referencia_id as string, b as { arquivo_path: string; nome_arquivo: string });

  const ordem = (t: string) => TIPOS_KIT.indexOf(t);
  if (modo === "nota" && !(docs ?? []).some((d) => d.tipo === "nota_fatura") ) return responder({ erro: "Anexe a nota fatura antes de enviar." }, 409);
  if (modo === "nota" && !(docs ?? []).some((d) => d.tipo === "demonstrativo")) return responder({ erro: "Anexe pelo menos um demonstrativo antes de enviar." }, 409);
  // nota: só os documentos da filial; boleto: só a carta de cessão (se houver) e os boletos; completo: tudo.
  const docsDoModo = (docs ?? []).filter((d) => modo === "completo" || (modo === "nota" ? d.tipo !== "carta_cessao" : d.tipo === "carta_cessao"));
  const lista = [
    ...[...docsDoModo].sort((a, b) => ordem(a.tipo as string) - ordem(b.tipo as string)).map((d) => ({ caminho: d.arquivo_path as string, nome: d.nome_arquivo as string })),
    ...(modo === "nota" ? [] : tituloIds.flatMap((id) => (boletoDe.has(id) ? [{ caminho: boletoDe.get(id)!.arquivo_path, nome: boletoDe.get(id)!.nome_arquivo }] : []))),
  ];
  const arquivos: AnexoEmail[] = [];
  let total = 0;
  for (const a of lista) {
    const { data: blob, error } = await banco.storage.from("anexos").download(a.caminho);
    if (error || !blob) return responder({ erro: `Não foi possível ler o anexo ${a.nome}.` }, 500);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    total += bytes.length;
    if (total > LIMITE_ANEXOS_BYTES) return responder({ erro: "Os anexos somam mais de 20 MB (limite do Gmail)." }, 400);
    arquivos.push({ nome: a.nome, tipo: tipoDoArquivo(a.nome), bytes });
  }

  // 5) Rascunho no Gmail da pessoa.
  const novoMessageId = `<kit-${kitId}.${crypto.randomUUID()}@neoformas.com.br>`;
  const buscar = (u: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }) => fetch(u, init as RequestInit);
  let rascunho;
  try {
    const mime = montarMime({
      de: c.email, para: mensagem.destinatario as string, cc: (mensagem.cc as string | null) ?? null,
      assunto: (mensagem.assunto as string | null) ?? "", corpo: mensagem.corpo as string, anexos: arquivos,
      // O primeiro e-mail ganha um Message-ID próprio; o do boleto responde a ele (mesma conversa).
      messageId: modo === "nota" ? novoMessageId : null,
      inReplyTo: modo === "boleto" ? (kit.email_message_id as string | null) : null,
    });
    const acesso = await obterAccessToken(buscar, { clientId, clientSecret, refreshToken: c.refresh_token, remetente: c.email });
    rascunho = await criarRascunho(buscar, acesso, mime, { threadId: modo === "boleto" ? (kit.gmail_thread_id as string | null) : null });
  } catch (e) {
    let texto = e instanceof GmailErro ? e.message : "Falha inesperada ao criar o rascunho.";
    if (/token de autoriza/i.test(texto)) texto = "A autorização do seu Gmail expirou ou foi revogada: clique em \"Conectar meu Gmail\" de novo.";
    await banco.from("mensagens").update({ erro: texto }).eq("id", mensagemId);
    return responder({ erro: texto }, e instanceof GmailErro && e.status && e.status < 500 ? 400 : 502);
  }

  // 6) Registro: rascunho na mensagem, conversa no kit (modo nota) e histórico em cada parcela.
  if (modo === "nota") {
    await banco.rpc("rec_kit_registrar_conversa", {
      p_kit: kitId, p_thread: rascunho.threadId ?? "", p_message_id: novoMessageId, p_assunto: (mensagem.assunto as string | null) ?? "",
    });
  }
  const { error: erroMensagem } = await banco.from("mensagens").update({ id_externo: rascunho.rascunhoId, erro: null }).eq("id", mensagemId);
  const { error: erroInteracao } = tituloIds.length ? await banco.from("interacoes").insert(tituloIds.map((t) => ({
    modulo: "financeiro.recebiveis", contraparte_id: mensagem.contraparte_id, referencia_tabela: "rec_titulos", referencia_id: t, canal: "email", tipo: "rascunho_gmail",
    descricao: `Rascunho do e-mail ${modo === "nota" ? "da nota e do demonstrativo" : modo === "boleto" ? "do boleto" : "do kit"} da NF ${Number(kit.nota_fiscal)} criado no Gmail de ${c.email} (${mensagem.destinatario}), com ${arquivos.length} anexos. Aguardando conferência e envio.`,
    usuario_id: usuarioId,
  }))) : { error: null };
  const aviso = erroMensagem || erroInteracao ? "O rascunho foi criado, mas parte do registro no Neo Admin falhou." : undefined;
  return responder({ ok: true, url: rascunho.url, anexos: arquivos.length, aviso });
});
