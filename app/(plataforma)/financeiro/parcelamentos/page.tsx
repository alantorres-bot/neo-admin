import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { emCentavos, MODULO_PARCELAMENTOS, ROTA_PARCELAMENTOS, ROTULO_ORIGEM, ROTULO_SITUACAO } from "@/lib/modulos/financeiro/parcelamentos/parcelamentos";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { BotaoSimples, FormParcelamento } from "./componentes";
import { listarApoio, listarParcelamentos } from "./dados";

export const metadata: Metadata = { title: "Gestão de Parcelamentos" };

const moeda = (v: string | number | null) => formatarMoeda(emCentavos(v) ?? 0);

export default async function PaginaParcelamentos() {
  const sessao = await exigirSessao();
  const supabase = await criarClienteServidor();
  const [lista, apoio] = await Promise.all([listarParcelamentos(supabase), listarApoio(supabase)]);
  const operador = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_PARCELAMENTOS, "operador");
  const gestor = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_PARCELAMENTOS, "gestor");
  const r = apoio.ultimaRodada;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {r ? <>Última leitura do Consistem: {formatarData(r.iniciada_em)} {new Date(r.iniciada_em).toLocaleTimeString("pt-BR", { timeZone: "America/Cuiaba", hour: "2-digit", minute: "2-digit" })}
            {r.situacao === "erro" ? <span className="text-destructive"> — falhou: {r.erro}</span> : r.situacao === "em_andamento" ? " (em andamento)" : ""}</> : "Ainda não houve leitura do Consistem."}
          {apoio.aguardandoDetalhe > 0 && ` · ${apoio.aguardandoDetalhe} lançamento(s) aguardando a conta de fluxo (próxima atualização).`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {gestor && <FormParcelamento inicial={{ situacao: "ativo" }} naturezas={apoio.naturezas} empresas={apoio.empresas} rotulo="Novo parcelamento manual" titulo="Novo parcelamento" variante="outline" />}
          {operador && <BotaoSimples acao="sincronizar" rotulo="Atualizar do Consistem" pendenteRotulo="Lendo o Consistem…" />}
        </div>
      </div>

      {lista.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum parcelamento cadastrado. Depois de atualizar do Consistem, crie os parcelamentos a partir das sugestões em{" "}
          <Link className="underline" href={`${ROTA_PARCELAMENTOS}/classificacao`}>Classificação</Link>.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[3px] border border-grade">
          <Table className="cartoes">
            <TableHeader>
              <TableRow>
                <TableHead>Parcelamento</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Natureza</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Parcelas</TableHead>
                <TableHead className="text-right">Pago</TableHead>
                <TableHead className="text-right">Em aberto</TableHead>
                <TableHead>Próximo vencimento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link className="underline-offset-2 hover:underline" href={`${ROTA_PARCELAMENTOS}/${p.id}`}>{p.descricao}</Link>
                    {p.chave_erp && <span className="block text-xs text-muted-foreground">Chave {p.chave_erp}</span>}
                  </TableCell>
                  <TableCell>{p.empresa_nome}</TableCell>
                  <TableCell>{p.natureza_nome}</TableCell>
                  <TableCell>{ROTULO_ORIGEM[p.origem] ?? p.origem}</TableCell>
                  <TableCell><Badge variant={p.situacao === "ativo" ? "secondary" : "outline"}>{ROTULO_SITUACAO[p.situacao]}</Badge></TableCell>
                  <TableCell className="text-right">{p.parcelas_pagas}/{p.parcelas_registradas}{p.qtd_parcelas ? ` de ${p.qtd_parcelas}` : ""}</TableCell>
                  <TableCell className="text-right">{moeda(p.total_pago)}</TableCell>
                  <TableCell className="text-right">{moeda(p.total_em_aberto)}</TableCell>
                  <TableCell>{formatarData(p.proximo_vencimento) || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        &quot;Em aberto&quot; soma as parcelas registradas e ainda não pagas (valor do Consistem; parcelas futuras só existem se já foram provisionadas).
      </p>
    </section>
  );
}
