// Começa o "Entrar com Google". É um GET (link na tela de login), e não um Server Action: a CSP
// `form-action 'self'` (next.config.ts) barraria o redirecionamento de um POST para accounts.google.com.
// O Supabase gera a URL do Google (fluxo PKCE) e o cookie do verificador é gravado aqui mesmo;
// a volta é em /auth/callback. Rota pública (proxy.ts). Detalhes: docs/LOGIN_GOOGLE.md.
import { NextResponse, type NextRequest } from "next/server";
import { DOMINIO_PERMITIDO } from "@/lib/nucleo/login";
import { destinoSeguro, origemDaRequisicao } from "@/lib/nucleo/redirecionamento";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export async function GET(request: NextRequest) {
  const origem = origemDaRequisicao(request.headers);
  const proximo = destinoSeguro(request.nextUrl.searchParams.get("proximo"));

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origem}/auth/callback?proximo=${encodeURIComponent(proximo)}`,
      // hd: o Google já abre na conta da empresa; prompt: deixa escolher a conta quando há mais de uma logada.
      queryParams: { hd: DOMINIO_PERMITIDO, prompt: "select_account" },
    },
  });
  if (error || !data.url) return NextResponse.redirect(`${origem}/login?erro=google`);
  return NextResponse.redirect(data.url);
}
