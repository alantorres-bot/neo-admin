// Edge Function do módulo Financeiro/Cartão de crédito: cadastra no Consistem o fornecedor "Outros" (classificação 3) de um
// estabelecimento de cartão, reservado pelo painel. Regras em docs/modulos/financeiro-cartao.md, seção 5, regras 44 a 49;
// migration 0140. O corpo (nome, tipo 3, endereço fixo, categoria e grupo) foi montado pelo banco na reserva.
//
// Quem chama: SÓ usuário logado, operador do Financeiro (ou acima), e só quem reservou. Corpo: { "id": "<uuid>" }.
// Código: o Consistem exige no tipo 3 o "registro do fornecedor" (campo cpfCnpj) = o próprio código com 7 dígitos (1375 →
// 0001375). A função descobre o próximo código do Consistem (maior existente + 1) e manda codFornecedor e cpfCnpj.
// Envia UMA vez (PUT cadastrosgerais/v10/fornecedor): cadastrado (com o código; vai para o espelho e para a sugestão do
// estabelecimento), erro (4xx, nada criado) ou incerto (fica "enviando": conferir no Consistem e resolver à mão).
// Segredos: CONSISTEM_API_KEY (token do CSMEN050) e CONSISTEM_BASE_URL (opcional).
//
// Deploy: npx supabase functions deploy crt-cadastrar-fornecedor --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import { BASE_URL_PADRAO, buscarObjeto, ConsistemErro, limparToken } from "../_shared/consistem-receber.ts";
import { incluirFornecedor } from "../_shared/consistem-inclusao.ts";

const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  const autorizacao = req.headers.get("Authorization") ?? "";
  if (!autorizacao) return responder({ erro: "Não autenticado." }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const chaveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);

  const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
  const { data: quem, error: erroUsuario } = await comoUsuario.auth.getUser();
  if (erroUsuario || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
  const { data: permitido } = await comoUsuario.rpc("tem_acesso_area", { p_area: "financeiro", p_minimo: "operador" });
  if (permitido !== true) return responder({ erro: "Somente operador do Financeiro (ou acima) cadastra fornecedor no Consistem." }, 403);

  let corpo: { id?: string } = {};
  try { corpo = await req.json(); } catch { /* vazio */ }
  if (!corpo.id || !UUID.test(corpo.id)) return responder({ erro: "Cadastro inválido." }, 400);
  const token = limparToken(Deno.env.get("CONSISTEM_API_KEY") ?? "");
  if (!token) return responder({ erro: "O segredo CONSISTEM_API_KEY não está configurado neste projeto." }, 500);

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: reserva } = await banco.from("crt_fornecedores_cadastrados").select("id, empresa_id, situacao, criado_por").eq("id", corpo.id).maybeSingle();
  if (!reserva) return responder({ erro: "Cadastro não encontrado." }, 404);
  if (reserva.criado_por !== quem.user.id) return responder({ erro: "Só quem conferiu o cadastro pode enviá-lo." }, 403);
  if (reserva.situacao !== "reservado") return responder({ erro: "Este cadastro já foi enviado." }, 409);
  const { data: empresa } = await banco.from("empresas").select("codigo_erp").eq("id", reserva.empresa_id).maybeSingle();
  if (!empresa?.codigo_erp) return responder({ erro: "A empresa não tem o código do Consistem (empresas.codigo_erp)." }, 400);

  const { data: item, error: erroInicio } = await banco.rpc("crt_iniciar_cadastro_fornecedor", { p_id: reserva.id });
  if (erroInicio || !item) return responder({ erro: erroInicio?.message ?? "Não foi possível iniciar o envio." }, 409);

  const cfg = { baseUrl: Deno.env.get("CONSISTEM_BASE_URL") || BASE_URL_PADRAO, token, empresa: String(empresa.codigo_erp) };
  // Código: o Consistem dá o próximo número do seu contador (a tela pula códigos já consumidos — ex.: 1372 e 1373 livres e o
  // próximo foi 1374) e o registro do tipo 3 tem de ser igual a ele. Procura, a partir do maior do espelho, o MAIOR código que
  // existe no Consistem (anda enquanto achar um existente nos próximos 15 números) e usa o seguinte.
  const { data: inicial } = await banco.rpc("crt_proximo_codigo_fornecedor", { p_empresa: reserva.empresa_id });
  const existe = async (cod: number): Promise<boolean> => {
    try {
      const f = await buscarObjeto((u, init) => fetch(u, init), cfg, `cadastrosgerais/v10/fornecedor/${cod}`);
      return String(f.codFornecedor ?? "") === String(cod);
    } catch (e) {
      if (e instanceof ConsistemErro && (e.status === 400 || e.status === 404)) return false;
      throw e;
    }
  };
  let maiorExistente = (Number(inicial) || 1) - 1;
  try {
    for (let cod = maiorExistente + 1, semAchar = 0; cod <= 99999 && semAchar < 15; cod++) {
      if (await existe(cod)) { maiorExistente = cod; semAchar = 0; } else semAchar++;
    }
  } catch (e) {
    const mensagem = `Não foi possível conferir os códigos de fornecedor no Consistem: ${e instanceof Error ? e.message : "falha"}. Nada foi enviado.`;
    await banco.rpc("crt_concluir_cadastro_fornecedor", { p_id: reserva.id, p_cod: null, p_resposta: null, p_erro: mensagem });
    return responder({ ok: false, tipo: "erro", mensagem }, 502);
  }
  const codigo = maiorExistente + 1;
  if (codigo < 1 || codigo > 99999) {
    const mensagem = "Código de fornecedor fora da faixa. Nada foi enviado.";
    await banco.rpc("crt_concluir_cadastro_fornecedor", { p_id: reserva.id, p_cod: null, p_resposta: null, p_erro: mensagem });
    return responder({ ok: false, tipo: "erro", mensagem }, 409);
  }
  const corpoFornecedor = { ...((item as { payload: Record<string, unknown> }).payload), codFornecedor: codigo, cpfCnpj: String(codigo).padStart(7, "0") };
  const r = await incluirFornecedor((u, init) => fetch(u, init), cfg, corpoFornecedor);
  const resposta = { enviado: corpoFornecedor, retorno: r.resposta ?? null };
  if (r.tipo === "incerto") {
    await banco.from("crt_fornecedores_cadastrados").update({ erro: `${r.mensagem} Código tentado: ${codigo}.`, resposta }).eq("id", reserva.id);
    return responder({ ok: false, tipo: "incerto", mensagem: r.mensagem }, 502);
  }
  const { error: erroConcluir } = await banco.rpc("crt_concluir_cadastro_fornecedor", {
    p_id: reserva.id, p_cod: r.tipo === "lancado" ? r.codigo : null, p_resposta: resposta, p_erro: r.tipo === "erro" ? r.mensagem : null,
  });
  if (erroConcluir) {
    const mensagem = r.tipo === "lancado"
      ? `O Consistem criou o fornecedor ${r.codigo}, mas o registro no Neo Admin falhou (${erroConcluir.message}). Resolva à mão com esse código.`
      : `Erro do Consistem não registrado: ${r.mensagem}`;
    await banco.from("crt_fornecedores_cadastrados").update({ erro: mensagem }).eq("id", reserva.id);
    return responder({ ok: false, tipo: "incerto", mensagem }, 500);
  }
  if (r.tipo === "erro") return responder({ ok: false, tipo: "erro", mensagem: r.mensagem }, 422);
  return responder({ ok: true, tipo: "cadastrado", codFornecedor: r.codigo });
});
