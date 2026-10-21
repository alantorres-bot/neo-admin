import type { Metadata } from "next";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerSetores } from "../dados";
import { EditorSetores } from "./editor";

export const metadata: Metadata = { title: "Ponto — setores e líderes" };

export default async function PaginaSetoresPonto() {
  const sessao = await exigirSessao();
  const supabase = await criarClienteServidor();
  const setores = await lerSetores(supabase);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Cada setor que recebe o relatório de inconsistências tem um e-mail que recebe o link do formulário (e, se quiser, e-mails em cópia).
        O link abre sem login: qualquer pessoa que o tiver preenche, e quem envia informa o nome. Pode ser qualquer endereço, inclusive fora da Neo.
      </p>
      <EditorSetores setores={setores} ehGestor={temAcesso(sessao.acesso, "rh", "gestor")} />
    </div>
  );
}
