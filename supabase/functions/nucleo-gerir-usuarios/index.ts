// Edge Function do núcleo: gestão de usuários do Supabase Auth.
// É o ÚNICO lugar que usa a service role para isso (CLAUDE.md: service role só em Edge Functions).
// Só o admin_geral pode chamar: o JWT do chamador é verificado e a função do banco eh_admin_geral()
// decide, antes de qualquer operação privilegiada.
//
// Corpo (JSON), campo `acao`:
//   criar_usuario   { email, nome, senha }
//   redefinir_senha { id, senha }
//   definir_ativo   { id, ativo }
//
// Deploy: npx supabase functions deploy nucleo-gerir-usuarios
import { createClient } from "jsr:@supabase/supabase-js@2";

const CABECALHOS = { "Content-Type": "application/json; charset=utf-8" };
const responder = (corpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: CABECALHOS });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SENHA_MINIMA = 8;
const BAN_PERMANENTE = "876000h"; // ~100 anos; "none" remove o bloqueio

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);

  const autorizacao = req.headers.get("Authorization");
  if (!autorizacao) return responder({ erro: "Não autenticado." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const chaveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);

  // 1) Quem está chamando? Cliente com o JWT do usuário (RLS e funções do banco valem).
  const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
  const { data: quem, error: erroUsuario } = await comoUsuario.auth.getUser();
  if (erroUsuario || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
  const { data: ehAdmin, error: erroAdmin } = await comoUsuario.rpc("eh_admin_geral");
  if (erroAdmin || ehAdmin !== true) return responder({ erro: "Somente o administrador geral pode gerir usuários." }, 403);

  // 2) A partir daqui, operações privilegiadas.
  const admin = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return responder({ erro: "Corpo inválido." }, 400);
  }

  switch (corpo.acao) {
    case "criar_usuario": {
      const email = String(corpo.email ?? "").trim().toLowerCase();
      const nome = String(corpo.nome ?? "").trim();
      const senha = String(corpo.senha ?? "");
      if (!EMAIL.test(email)) return responder({ erro: "E-mail inválido." }, 400);
      if (nome.length < 2) return responder({ erro: "Informe o nome." }, 400);
      if (senha.length < SENHA_MINIMA) return responder({ erro: `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.` }, 400);

      // O gatilho (migrations 0003/0005) cria o perfil sem nenhuma permissão e, por causa de
      // app_metadata.deve_trocar_senha (que só a service role grava), com a troca de senha obrigatória.
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: senha,
        email_confirm: true,
        user_metadata: { nome },
        app_metadata: { deve_trocar_senha: true },
      });
      if (error) {
        if (error.code === "email_exists") return responder({ erro: "Já existe um usuário com este e-mail." }, 409);
        if (error.code === "weak_password") return responder({ erro: "Senha fraca. Use letras e números." }, 400);
        return responder({ erro: "Não foi possível criar o usuário." }, 500);
      }
      return responder({ ok: true, id: data.user.id });
    }

    case "redefinir_senha": {
      const id = String(corpo.id ?? "");
      const senha = String(corpo.senha ?? "");
      if (!UUID.test(id)) return responder({ erro: "Usuário inválido." }, 400);
      if (senha.length < SENHA_MINIMA) return responder({ erro: `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.` }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, { password: senha });
      if (error) return responder({ erro: error.code === "weak_password" ? "Senha fraca. Use letras e números." : "Não foi possível redefinir a senha." }, 400);

      // Trocar a senha no Auth libera o perfil (gatilho da 0005); por isso a marca é posta DEPOIS.
      // O admin redefinindo a própria senha escolhe a que quer: não é forçado a trocar de novo.
      if (id !== quem.user.id) {
        const { error: erroMarca } = await admin.from("perfis").update({ deve_trocar_senha: true }).eq("id", id);
        if (erroMarca) return responder({ erro: "Senha redefinida, mas não foi possível exigir a troca no primeiro acesso. Tente novamente." }, 500);
      }
      return responder({ ok: true });
    }

    case "definir_ativo": {
      const id = String(corpo.id ?? "");
      const ativo = corpo.ativo === true;
      if (!UUID.test(id)) return responder({ erro: "Usuário inválido." }, 400);
      if (id === quem.user.id && !ativo) return responder({ erro: "Você não pode desativar a si mesmo." }, 400);

      // Perfil primeiro: o gatilho do banco impede desativar o último administrador geral.
      const { error: erroPerfil } = await admin.from("perfis").update({ ativo }).eq("id", id);
      if (erroPerfil) return responder({ erro: erroPerfil.code === "P0001" ? erroPerfil.message : "Não foi possível alterar o usuário." }, 400);

      // Bloqueia (ou libera) o login no Auth, para a sessão não ser renovada.
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: ativo ? "none" : BAN_PERMANENTE });
      if (error) return responder({ erro: "Perfil alterado, mas o bloqueio do login falhou. Tente novamente." }, 500);
      return responder({ ok: true });
    }

    default:
      return responder({ erro: "Ação desconhecida." }, 400);
  }
});
