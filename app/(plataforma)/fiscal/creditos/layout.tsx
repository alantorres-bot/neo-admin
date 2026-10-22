import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Abas } from "@/components/plataforma/abas";
import { AVISO_RESPONSABILIDADE, MODULO_CREDITOS, NOME_SISTEMA, ROTA_CREDITOS, ROTULO_PAPEL } from "@/lib/modulos/fiscal/creditos/modulo";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { contexto } from "./dados";

export const metadata: Metadata = { title: { template: `%s · ${NOME_SISTEMA}`, default: NOME_SISTEMA } };

const ABAS = [
  { href: `${ROTA_CREDITOS}/painel`, rotulo: "Dashboard" },
  { href: `${ROTA_CREDITOS}/creditos`, rotulo: "Créditos tributários" },
  { href: `${ROTA_CREDITOS}/movimentos`, rotulo: "Movimentações" },
  { href: `${ROTA_CREDITOS}/apuracao`, rotulo: "Apuração mensal" },
  { href: `${ROTA_CREDITOS}/consolidado`, rotulo: "Consolidado anual" },
  { href: `${ROTA_CREDITOS}/obrigacoes`, rotulo: "Obrigações fiscais" },
  { href: `${ROTA_CREDITOS}/documentos`, rotulo: "Documentos" },
  { href: `${ROTA_CREDITOS}/conciliacao`, rotulo: "Conciliação" },
  { href: `${ROTA_CREDITOS}/tarefas`, rotulo: "Tarefas e aprovações" },
  { href: `${ROTA_CREDITOS}/relatorios`, rotulo: "Relatórios" },
  { href: `${ROTA_CREDITOS}/configuracoes`, rotulo: "Configurações" },
];

export default async function LayoutCreditos({ children }: LayoutProps<"/fiscal/creditos">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO_CREDITOS);
  if (!modulo || !modulo.ativo || !temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_CREDITOS)) notFound();
  const { papel } = await contexto();
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="font-condensada text-2xl font-bold tracking-tight">{NOME_SISTEMA} — Créditos e obrigações tributárias</h1>
          <p className="max-w-4xl text-xs text-muted-foreground">{AVISO_RESPONSABILIDADE}</p>
        </div>
        {papel && <span className="rounded-[3px] border bg-cabecalho px-2 py-1 text-xs">Seu papel: <strong>{ROTULO_PAPEL[papel]}</strong></span>}
      </div>
      <Abas abas={ABAS} />
      {children}
    </div>
  );
}
