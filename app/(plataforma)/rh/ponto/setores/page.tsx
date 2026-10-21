import type { Metadata } from "next";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerPessoas, lerSetores } from "../dados";
import { EditorSetores } from "./editor";

export const metadata: Metadata = { title: "Ponto — setores e líderes" };

export default async function PaginaSetoresPonto() {
  const sessao = await exigirSessao();
  const supabase = await criarClienteServidor();
  const [setores, pessoas] = await Promise.all([lerSetores(supabase), lerPessoas(supabase)]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Cada setor que recebe o relatório de inconsistências tem um líder (recebe o e-mail) e, se quiser, um substituto (vai em cópia). Os dois veem e
        enviam as justificativas do setor, entrando com a conta Google; nenhum deles precisa da área RH. O líder tem de ter usuário no Neo Admin
        (Configurações &gt; Usuários).
      </p>
      <EditorSetores setores={setores} pessoas={pessoas} ehGestor={temAcesso(sessao.acesso, "rh", "gestor")} />
    </div>
  );
}
