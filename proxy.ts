// Next 16: `proxy.ts` substitui o antigo `middleware.ts`.
// Aqui só renovamos a sessão do Supabase e fazemos o redirecionamento otimista para o login.
// A verificação de verdade (getUser + permissões) acontece em lib/nucleo/sessao.ts, perto dos dados.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ambienteSupabase } from "@/lib/supabase/ambiente";

export async function proxy(request: NextRequest) {
  const { url, chave } = ambienteSupabase();
  let resposta = NextResponse.next({ request });

  const supabase = createServerClient(url, chave, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (lista) => {
        for (const { name, value } of lista) request.cookies.set(name, value);
        resposta = NextResponse.next({ request });
        for (const { name, value, options } of lista) resposta.cookies.set(name, value, options);
      },
    },
  });

  // getClaims valida o token e renova a sessão quando preciso (sem ida ao banco a cada clique).
  const { data } = await supabase.auth.getClaims();
  const logado = Boolean(data?.claims);
  const { pathname, search } = request.nextUrl;
  const naTelaDeLogin = pathname === "/login";

  if (!logado && !naTelaDeLogin) {
    const destino = request.nextUrl.clone();
    destino.pathname = "/login";
    destino.search = pathname === "/" ? "" : `?proximo=${encodeURIComponent(pathname + search)}`;
    const redirecionamento = NextResponse.redirect(destino);
    for (const c of resposta.cookies.getAll()) redirecionamento.cookies.set(c);
    return redirecionamento;
  }

  if (logado && naTelaDeLogin) {
    const destino = request.nextUrl.clone();
    destino.pathname = "/inicio";
    destino.search = "";
    const redirecionamento = NextResponse.redirect(destino);
    for (const c of resposta.cookies.getAll()) redirecionamento.cookies.set(c);
    return redirecionamento;
  }

  return resposta;
}

export const config = {
  // Tudo, menos arquivos estáticos do Next e imagens.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
