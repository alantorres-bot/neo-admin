import type { Metadata } from "next";
import { buttonVariants } from "@/components/ui/button";
import { mensagemDeErroLogin } from "@/lib/nucleo/login";
import { destinoSeguro } from "@/lib/nucleo/redirecionamento";
import { FormLogin } from "./form-login";

export const metadata: Metadata = { title: "Entrar · Neo Admin" };

export default async function PaginaLogin({ searchParams }: PageProps<"/login">) {
  const { proximo, erro } = await searchParams;
  const destino = destinoSeguro(Array.isArray(proximo) ? proximo[0] : proximo);
  const aviso = mensagemDeErroLogin(erro);

  return (
    <main className="flex min-h-svh items-center justify-center bg-cabecalho p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-[3px] border border-grade bg-white shadow">
        <div className="bg-marca px-5 py-3 text-white">
          <h1 className="font-condensada text-lg font-bold leading-tight">Neo Admin</h1>
          <p className="text-xs text-white/85">Plataforma do Administrativo — Neo Formas</p>
        </div>
        <div className="grid gap-4 p-5">
          {aviso && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
              {aviso}
            </p>
          )}
          {/* Link, não formulário: a CSP form-action 'self' barraria o redirecionamento para o Google (docs/LOGIN_GOOGLE.md). */}
          <a href={`/auth/google?proximo=${encodeURIComponent(destino)}`} className={buttonVariants({ variant: "outline", className: "h-9 w-full" })}>
            <IconeGoogle />
            Entrar com Google
          </a>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            ou com e-mail e senha
            <span className="h-px flex-1 bg-border" />
          </div>
          <FormLogin proximo={destino} />
        </div>
      </div>
    </main>
  );
}

function IconeGoogle() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}
