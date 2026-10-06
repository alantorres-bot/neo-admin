import type { Metadata } from "next";
import { destinoSeguro } from "@/lib/nucleo/redirecionamento";
import { FormLogin } from "./form-login";

export const metadata: Metadata = { title: "Entrar · Neo Admin" };

export default async function PaginaLogin({ searchParams }: PageProps<"/login">) {
  const { proximo } = await searchParams;
  const destino = destinoSeguro(Array.isArray(proximo) ? proximo[0] : proximo);

  return (
    <main className="flex min-h-svh items-center justify-center bg-cabecalho p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-[3px] border border-grade bg-white shadow">
        <div className="bg-marca px-5 py-3 text-white">
          <h1 className="font-condensada text-lg font-bold leading-tight">Neo Admin</h1>
          <p className="text-xs text-white/85">Plataforma do Administrativo — Neo Formas</p>
        </div>
        <div className="p-5">
          <FormLogin proximo={destino} />
        </div>
      </div>
    </main>
  );
}
