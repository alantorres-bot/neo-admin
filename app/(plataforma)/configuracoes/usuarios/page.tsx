import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTULO_NIVEL } from "@/lib/nucleo/permissoes";
import { exigirAdminGeral } from "@/lib/nucleo/sessao";
import type { NivelAcesso, Perfil } from "@/lib/nucleo/tipos";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { DialogoNovoUsuario, DialogoPermissoes, DialogoSenha } from "./dialogos";

export const metadata: Metadata = { title: "Usuários e permissões" };

export default async function PaginaUsuarios() {
  const sessao = await exigirAdminGeral();
  const supabase = await criarClienteServidor();

  const [perfis, permissoes] = await Promise.all([
    supabase.from("perfis").select("id, nome, email, admin_geral, ativo, deve_trocar_senha").order("ativo", { ascending: false }).order("nome"),
    supabase.from("permissoes").select("perfil_id, area, nivel"),
  ]);
  if (perfis.error) throw new Error(`Falha ao ler os usuários: ${perfis.error.message}`);
  if (permissoes.error) throw new Error(`Falha ao ler as permissões: ${permissoes.error.message}`);

  const niveisPorPerfil = new Map<string, Record<string, NivelAcesso>>();
  for (const p of permissoes.data ?? []) {
    const atual = niveisPorPerfil.get(p.perfil_id) ?? {};
    atual[p.area] = p.nivel as NivelAcesso;
    niveisPorPerfil.set(p.perfil_id, atual);
  }
  const nomeDaArea = new Map(sessao.areas.map((a) => [a.codigo, a.nome]));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          Cada pessoa tem um nível por área (consulta, operador, gestor ou administrador). Áreas sensíveis, como Jurídico e RH/SST, só abrem para quem for liberado explicitamente.
        </p>
        <DialogoNovoUsuario />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table className="cartoes">
          <TableHeader>
            <TableRow>
              <TableHead>Usuário</TableHead>
              <TableHead>Acesso</TableHead>
              <TableHead className="w-64" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(perfis.data as Perfil[]).map((p) => {
              const niveis = niveisPorPerfil.get(p.id) ?? {};
              const liberadas = Object.entries(niveis).filter(([, n]) => n !== "sem_acesso");
              return (
                <TableRow key={p.id} className={p.ativo ? "" : "opacity-60"}>
                  <TableCell>
                    <p className="font-medium">
                      {p.nome}
                      {p.id === sessao.userId && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(você)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{p.email}</p>
                  </TableCell>
                  <TableCell className="space-x-1 space-y-1">
                    {p.admin_geral && <Badge>Administrador geral</Badge>}
                    {!p.ativo && <Badge variant="outline">Desativado</Badge>}
                    {p.ativo && p.deve_trocar_senha && <Badge variant="outline">Aguardando troca de senha</Badge>}
                    {!p.admin_geral && liberadas.length === 0 && <span className="text-xs text-muted-foreground">Sem permissão em nenhuma área</span>}
                    {!p.admin_geral && liberadas.map(([area, nivel]) => (
                      <Badge key={area} variant="secondary">{nomeDaArea.get(area) ?? area}: {ROTULO_NIVEL[nivel]}</Badge>
                    ))}
                  </TableCell>
                  <TableCell className="text-right">
                    <DialogoPermissoes perfil={p} areas={sessao.areas} niveis={niveis} ehOProprio={p.id === sessao.userId} />
                    <DialogoSenha perfil={p} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
