// Next 16: `proxy.ts` substitui o antigo `middleware.ts`.
// Aqui só renovamos a sessão do Supabase, fazemos o redirecionamento otimista para o login e registramos o acesso
// (Central de Gestão > Atividades; o banco só grava com `administrativo.gestao.registrar_acessos` ligado).
// A verificação de verdade (getUser + permissões) acontece em lib/nucleo/sessao.ts, perto dos dados.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { ambienteSupabase } from "@/lib/supabase/ambiente";

/** Navegação de verdade: GET de página (não é pré-carregamento do link nem chamada de ação de servidor). */
function ehNavegacao(request: NextRequest): boolean {
  return request.method === "GET" && !request.headers.has("next-router-prefetch") && request.headers.get("purpose") !== "prefetch"
    && !request.nextUrl.pathname.startsWith("/api/");
}

export async function proxy(request: NextRequest, evento: NextFetchEvent) {
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
  // /auth/* = ida e volta do "Entrar com Google" (docs/LOGIN_GOOGLE.md): precisa funcionar sem sessão.
  // /justificar-ponto/<chave> = formulário do ponto aberto a quem tem o link (RH > Ponto; a chave é conferida no banco).
  const rotaPublica = naTelaDeLogin || pathname.startsWith("/auth/") || pathname.startsWith("/justificar-ponto/");

  if (!logado && !rotaPublica) {
    const destino = request.nextUrl.clone();
    destino.pathname = "/login";
    destino.search = pathname === "/" ? "" : `?proximo=${encodeURIComponent(pathname + search)}`;
    const redirecionamento = NextResponse.redirect(destino);
    for (const c of resposta.cookies.getAll()) redirecionamento.cookies.set(c);
    return redirecionamento;
  }

  if (logado && !rotaPublica && ehNavegacao(request)) {
    // Depois da resposta (não atrasa a tela); falha no registro não afeta o usuário.
    evento.waitUntil(
      Promise.resolve(supabase.rpc("registrar_acesso", { p_rota: pathname })).then(() => undefined, () => undefined),
    );
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
