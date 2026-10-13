import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MODULO_FILIAL, ROTA_FILIAL } from "@/lib/modulos/financeiro/filial/arquivos";
import { temAcesso, temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";

export default async function LayoutFilial({ children }: LayoutProps<"/financeiro/filial">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_FILIAL);
  if (!modulo || !modulo.ativo || !temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_FILIAL)) notFound();
  const podeEnviar = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_FILIAL, "operador");
  const ehCuiaba = temAcesso(sessao.acesso, "financeiro", "operador");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Faturamento Filial</h1>
          <p className="text-sm text-muted-foreground">
            Todas as notas da Filial Contagem numa fila só, da mais urgente para a menos. Cada NF mostra em que estágio está e a próxima
            tarefa; clique para abrir tudo dela ao lado.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ehCuiaba && <Button variant="outline" nativeButton={false} render={<Link href={`${ROTA_FILIAL}/boletos`} />}>Anexar boletos</Button>}
          {podeEnviar && <Button nativeButton={false} render={<Link href={`${ROTA_FILIAL}/enviar`} />}>Enviar faturas</Button>}
        </div>
      </div>
      {children}
    </div>
  );
}
