import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { destinoSeguro } from "@/lib/nucleo/redirecionamento";
import { FormLogin } from "./form-login";

export const metadata: Metadata = { title: "Entrar · Neo Admin" };

export default async function PaginaLogin({ searchParams }: PageProps<"/login">) {
  const { proximo } = await searchParams;
  const destino = destinoSeguro(Array.isArray(proximo) ? proximo[0] : proximo);

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Neo Admin</CardTitle>
          <CardDescription>Plataforma do Administrativo · Neo Formas</CardDescription>
        </CardHeader>
        <CardContent>
          <FormLogin proximo={destino} />
        </CardContent>
      </Card>
    </main>
  );
}
