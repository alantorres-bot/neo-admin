import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROTULO_NIVEL, nivelNaArea } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { FormSenha } from "./form-senha";

export const metadata: Metadata = { title: "Minha conta" };

export default async function PaginaConta() {
  const sessao = await exigirSessao({ permitirTrocaPendente: true });
  const obrigatoria = sessao.perfil.ativo && sessao.perfil.deve_trocar_senha;
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Minha conta</h1>

      {obrigatoria && (
        <div role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Troque a senha para continuar.</p>
          <p className="text-muted-foreground">A senha atual foi definida pelo administrador. Escolha uma senha só sua; depois disso o acesso à plataforma é liberado.</p>
        </div>
      )}

      {!obrigatoria && <Card>
        <CardHeader>
          <CardTitle>{sessao.perfil.nome}</CardTitle>
          <CardDescription>{sessao.perfil.email}{sessao.acesso.adminGeral ? " · Administrador geral" : ""}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1 text-sm">
            {sessao.areas.map((a) => (
              <li key={a.codigo} className="flex justify-between border-b py-1 last:border-0">
                <span>{a.nome}</span>
                <span className="text-muted-foreground">{ROTULO_NIVEL[nivelNaArea(sessao.acesso, a.codigo)]}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>}

      <Card>
        <CardHeader>
          <CardTitle>{obrigatoria ? "Defina a sua senha" : "Alterar senha"}</CardTitle>
          <CardDescription>Mínimo de 8 caracteres.</CardDescription>
        </CardHeader>
        <CardContent>
          <FormSenha />
        </CardContent>
      </Card>
    </div>
  );
}
