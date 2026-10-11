// Login com Google (conta do Workspace da Neo Formas). Só regras puras, testadas em login.test.ts;
// quem fala com o Supabase são as rotas em app/auth/*. Como funciona: docs/LOGIN_GOOGLE.md.

/** Domínio das contas Google da empresa. O consentimento OAuth é Interno (só este Workspace); aqui é a defesa extra. */
export const DOMINIO_PERMITIDO = "neoformas.com.br";

export type ErroLogin = "sem_cadastro" | "desativado" | "dominio" | "google";

export const MENSAGEM_ERRO_LOGIN: Record<ErroLogin, string> = {
  sem_cadastro: "Este e-mail ainda não tem acesso ao Neo Admin. Peça ao administrador para cadastrá-lo.",
  desativado: "Este acesso está desativado. Fale com o administrador.",
  dominio: `Use a conta Google da empresa (@${DOMINIO_PERMITIDO}).`,
  google: "Não foi possível entrar com o Google agora. Tente de novo ou use e-mail e senha.",
};

/**
 * O Supabase devolve recusas na URL de retorno (`?error=access_denied&error_code=...`) antes de existir
 * código para trocar por sessão. Traduz esse código para o aviso da tela de login.
 */
export function codigoDeErroLogin(errorCode: string | null | undefined): ErroLogin {
  switch (errorCode) {
    case "signup_disabled":
      return "sem_cadastro"; // cadastro fechado: só entra quem o admin já criou
    case "user_banned":
      return "desativado";
    default:
      return "google";
  }
}

/** Texto do aviso para `?erro=` da tela de login; `null` quando não há (ou não é um código nosso). */
export function mensagemDeErroLogin(codigo: string | string[] | null | undefined): string | null {
  const c = Array.isArray(codigo) ? codigo[0] : codigo;
  return c && Object.hasOwn(MENSAGEM_ERRO_LOGIN, c) ? MENSAGEM_ERRO_LOGIN[c as ErroLogin] : null;
}

/** O e-mail é da empresa? (um só `@`, domínio exato, sem diferenciar maiúsculas) */
export function emailDoDominio(email: string | null | undefined, dominio = DOMINIO_PERMITIDO): boolean {
  if (!email) return false;
  const partes = email.trim().toLowerCase().split("@");
  return partes.length === 2 && partes[0].length > 0 && partes[1] === dominio.toLowerCase();
}

/**
 * A sessão nasceu de um provedor externo (Google)? Lê a claim `amr` do JWT do Supabase
 * (`[{ method: "oauth" | "password" | ..., timestamp }]`). Sem `amr`, assume senha: nunca libera por engano.
 * Usada para a troca de senha pendente prender só quem entrou por senha (mesma regra no banco: `sessao_por_oauth()`).
 */
export function entrouPorOAuth(claims: { amr?: unknown } | null | undefined): boolean {
  const amr = claims?.amr;
  if (!Array.isArray(amr)) return false;
  return amr.some((m) => typeof m === "object" && m !== null && (m as { method?: unknown }).method === "oauth");
}
