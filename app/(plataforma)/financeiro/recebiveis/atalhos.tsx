import Link from "next/link";
import { Button } from "@/components/ui/button";
import { totalDeTarefas } from "@/lib/modulos/financeiro/recebiveis/tarefas";
import { RecebiveisAbas } from "./abas-recebiveis";
import { tarefasDaRequisicao } from "./tarefas/dados";

// Botões e abas da Carteira com os números de Tarefas, Clientes e Baixas. Os números vêm do cálculo completo das tarefas (muitas
// leituras no banco), então a Carteira os carrega à parte, dentro de <Suspense>: a tela aparece primeiro e os números chegam depois.

function Botoes({ tarefas, clientes, baixas }: { tarefas?: number; clientes?: number; baixas?: number }) {
  return (
    <>
      <Button render={<Link href="/financeiro/recebiveis/tarefas" />}>Tarefas{tarefas ? ` (${tarefas})` : ""}</Button>
      <Button variant="outline" render={<Link href="/financeiro/recebiveis/clientes" />}>
        Clientes e contatos{clientes ? ` (${clientes} para cadastrar)` : ""}
      </Button>
      <Button variant="outline" render={<Link href="/financeiro/recebiveis/baixas" />}>
        Baixas a conferir{baixas ? ` (${baixas})` : ""}
      </Button>
    </>
  );
}

export function BotoesSemNumeros() {
  return <Botoes />;
}

export async function BotoesComNumeros() {
  const t = await tarefasDaRequisicao();
  return <Botoes tarefas={totalDeTarefas(t)} clientes={t.contato.length} baixas={t.baixa.length} />;
}

export function AbasSemNumeros() {
  return <RecebiveisAbas ativa="carteira" />;
}

export async function AbasComNumeros() {
  const t = await tarefasDaRequisicao();
  return <RecebiveisAbas ativa="carteira" contagens={{ tarefas: totalDeTarefas(t), clientes: t.contato.length, baixas: t.baixa.length }} />;
}
