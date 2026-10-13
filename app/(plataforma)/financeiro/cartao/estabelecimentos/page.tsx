import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { normalizar } from "@/lib/modulos/financeiro/cartao/texto";
import { sanitizarBusca } from "@/lib/nucleo/erros";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { lerEstabelecimentos } from "../dados";
import { DialogoEstabelecimento } from "./form-estabelecimento";

export const metadata: Metadata = { title: "Estabelecimentos (dicionário)" };

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PaginaEstabelecimentos({ searchParams }: PageProps<"/financeiro/cartao/estabelecimentos">) {
  const sessao = await exigirSessao();
  const podeOperar = temAcesso(sessao.acesso, "financeiro", "operador");
  const parametros = await searchParams;
  const busca = sanitizarBusca(primeiro(parametros.q));
  const padraoSugerido = sanitizarBusca(primeiro(parametros.padrao));
  const todos = await lerEstabelecimentos(await criarClienteServidor());
  const termo = normalizar(busca);
  const lista = termo ? todos.filter((e) => normalizar(`${e.padrao} ${e.categoria} ${e.conta_fluxo ?? ""}`).includes(termo)) : todos;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            De/para do trecho que aparece na fatura → categoria → conta de fluxo de caixa (“Descrição Conta” do Consistem). Conta vazia = <strong>[CONFERIR]</strong> (marketplaces não têm conta fixa). Sempre que classificar um estabelecimento à mão, cadastre aqui: o dicionário deve crescer a cada fechamento.
          </p>
          <form method="get" className="flex items-center gap-2" role="search">
            <Input name="q" defaultValue={busca} placeholder="Buscar estabelecimento, categoria ou conta" aria-label="Buscar" className="w-80" />
            <Button type="submit" variant="outline" size="sm">Buscar</Button>
          </form>
        </div>
        {podeOperar && <DialogoEstabelecimento padraoSugerido={padraoSugerido || undefined} abrirAoCarregar={!!padraoSugerido} />}
      </div>
      <Table>
        <TableHeader>
          <TableRow><TableHead>Trecho na fatura</TableHead><TableHead>Categoria</TableHead><TableHead>Conta de fluxo</TableHead><TableHead>Consistem (fornecedor · fluxo · contábil)</TableHead><TableHead>Situação</TableHead>{podeOperar && <TableHead />}</TableRow>
        </TableHeader>
        <TableBody>
          {lista.map((e) => (
            <TableRow key={e.id} className={e.ativo ? "" : "text-muted-foreground"}>
              <TableCell className="font-medium">{e.padrao}</TableCell><TableCell>{e.categoria}</TableCell>
              <TableCell>{e.conta_fluxo ?? <span className="font-bold text-amber-700">[CONFERIR]</span>}</TableCell>
              <TableCell className="text-xs tabular-nums">{e.lancamento_erp ? [e.lancamento_erp.codFornecedor ?? "—", `${e.lancamento_erp.grupoContaFluxoCaixa ?? "—"}/${e.lancamento_erp.contaFluxoCaixa ?? "—"}`, e.lancamento_erp.contaContabilDebito ?? "—"].join(" · ") : <span className="text-muted-foreground">sem sugestão</span>}</TableCell>
              <TableCell>{e.ativo ? <Badge variant="outline" className="border-marca text-marca">Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}</TableCell>
              {podeOperar && <TableCell><DialogoEstabelecimento estabelecimento={e} /></TableCell>}
            </TableRow>
          ))}
          {lista.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Nenhum estabelecimento encontrado.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}
