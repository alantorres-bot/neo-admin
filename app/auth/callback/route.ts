// Volta do Google. O Supabase redireciona para cá com `?code=` (sucesso) ou com
// `?error=access_denied&error_code=...` (recusa: e-mail sem cadastro, acesso desativado).
// Troca o código pela sessão (cookies), confere o domínio do e-mail e segue para `proximo`.
// Rota pública (proxy.ts). Detalhes: docs/LOGIN_GOOGLE.md.
import { NextResponse, type NextRequest } from "next/server";
import { codigoDeErroLogin, emailDoDominio } from "@/lib/nucleo/login";
import { destinoSeguro, origemDaRequisicao } from "@/lib/nucleo/redirecionamento";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export async function GET(request: NextRequest) {
  const origem = origemDaRequisicao(request.headers);
  const parametros = request.nextUrl.searchParams;
  const voltarAoLogin = (erro: string) => NextResponse.redirect(`${origem}/login?erro=${erro}`);

  // Recusa vem antes de existir código: cadastro fechado (signup_disabled), usuário bloqueado (user_banned) etc.
  const errorCode = parametros.get("error_code");
  if (errorCode || parametros.get("error")) return voltarAoLogin(codigoDeErroLogin(errorCode));

  const code = parametros.get("code");
  if (!code) return voltarAoLogin("google");

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return voltarAoLogin("google");

  // Defesa extra: o consentimento OAuth é Interno (só o Workspace da empresa) e `hd` já pede a conta certa.
  if (!emailDoDominio(data.user.email)) {
    await supabase.auth.signOut();
    return voltarAoLogin("dominio");
  }

  return NextResponse.redirect(`${origem}${destinoSeguro(parametros.get("proximo"))}`);
}
