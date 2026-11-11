import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  contaFluxo, emCentavos, formatarCompetencia, MODULO_PARCELAMENTOS, ROTA_PARCELAMENTOS, ROTULO_CLASSIFICACAO, type Classificacao,
} from "@/lib/modulos/financeiro/parcelamentos/parcelamentos";
import { formatarData, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/formatos";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { BotaoDevolver, ClassificarLancamento, FormParcelamento, Vincular } from "../componentes";
import { listarApoio, listarLancamentos, listarSugestoes, type Lancamento } from "../dados";

export const metadata: Metadata = { title: "Classificação — Gestão de Parcelamentos" };

const ROTA = `${ROTA_PARCELAMENTOS}/classificacao`;
const moeda = (v: string | number | null) => (v === null ? "—" : formatarMoeda(emCentavos(v) ?? 0));
const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const VISOES: { codigo: string; nome: string; filtro: Classificacao[] }[] = [
  { codigo: "pendentes", nome: "Pendentes", filtro: ["pendente"] },
  { codigo: "aguardando", nome: "Aguardando conta de fluxo", filtro: ["aguardando_detalhe"] },
  { codigo: "sem-regra", nome: "Sem regra (para análise)", filtro: ["sem_regra"] },
  { codigo: "excecoes", nome: "Exceções", filtro: ["ignorado"] },
  { codigo: "manuais", nome: "Classificados à mão", filtro: ["manual_parcelamento", "manual_ignorado"] },
];

export default async function PaginaClassificacao({ searchParams }: PageProps<"/financeiro/parcelamentos/classificacao">) {
  const sessao = await exigirSessao();
  const ver = primeiro((await searchParams).ver);
  const visao = VISOES.find((v) => v.codigo === ver);
  const supabase = await criarClienteServidor();
  const operador = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_PARCELAMENTOS, "operador");
  const gestor = temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_PARCELAMENTOS, "gestor");
  const [apoio, sugestoes, lancs] = await Promise.all([
    listarApoio(supabase), visao ? Promise.resolve([]) : listarSugestoes(supabase), visao ? listarLancamentos(supabase, visao.filtro) : Promise.resolve([] as Lancamento[]),
  ]);

  return (
    <section className="space-y-4">
      <nav aria-label="Visão" className="flex flex-wrap gap-1">
        <Button size="sm" variant={!visao ? "default" : "outline"} nativeButton={false} render={<Link href={ROTA} />}>Sugestões de parcelamento</Button>
        {VISOES.map((v) => <Button key={v.codigo} size="sm" variant={visao?.codigo === v.codigo ? "default" : "outline"} nativeButton={false} render={<Link href={`${ROTA}?ver=${v.codigo}`} />}>{v.nome}</Button>)}
      </nav>

      {!visao ? (
        <>
          <p className="text-sm text-muted-foreground">
            Lançamentos já classificados como parcelamento, agrupados pela chave do documento (fornecedor + número antes do -MM/AA). Crie o parcelamento
            uma vez: as parcelas desta chave e as que vierem depois entram sozinhas. Se for a mesma obrigação de um parcelamento que já existe (ex.: o
            documento mudou de número), junte a ele.
          </p>
          {sugestoes.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma sugestão: todo lançamento classificado já está num parcelamento.</p>
          ) : (
            <div className="overflow-x-auto rounded-[3px] border border-grade">
              <Table className="cartoes">
                <TableHeader>
                  <TableRow>
                    <TableHead>Chave</TableHead><TableHead>Empresa</TableHead><TableHead>Fornecedor</TableHead><TableHead>Histórico</TableHead>
                    <TableHead>Conta de fluxo</TableHead><TableHead className="text-right">Lançamentos</TableHead><TableHead>Competências</TableHead>
                    <TableHead className="text-right">Total</TableHead><TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sugestoes.map((s) => (
                    <TableRow key={`${s.empresa_id}-${s.chave_erp}`}>
                      <TableCell>{s.chave_erp}</TableCell>
                      <TableCell>{s.empresa_nome}</TableCell>
                      <TableCell>{s.cod_fornecedor}{s.nome_fornecedor ? ` · ${s.nome_fornecedor}` : ""}</TableCell>
                      <TableCell>{s.complemento_exemplo ?? "—"}</TableCell>
                      <TableCell>{contaFluxo(s.grupo, s.conta)}</TableCell>
                      <TableCell className="text-right">{s.lancamentos}</TableCell>
                      <TableCell>{formatarCompetencia(s.primeira_competencia)} a {formatarCompetencia(s.ultima_competencia)}</TableCell>
                      <TableCell className="text-right">{moeda(s.valor_total)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {gestor && (
                            <FormParcelamento naturezas={apoio.naturezas} empresas={apoio.empresas} rotulo="Criar parcelamento" titulo="Criar parcelamento a partir do Consistem"
                              inicial={{
                                empresaId: s.empresa_id, chaveErp: s.chave_erp, natureza: s.naturezas === 1 ? s.natureza : "",
                                descricao: s.complemento_exemplo ?? s.chave_erp, credor: s.nome_fornecedor ?? "", codFornecedor: s.cod_fornecedor, situacao: "ativo",
                              }} />
                          )}
                          {operador && <Vincular empresaId={s.empresa_id} chave={s.chave_erp} parcelamentos={apoio.parcelamentos} rotulo="Juntar a existente" />}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      ) : lancs.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum lançamento nesta visão.</p>
      ) : (
        <div className="overflow-x-auto rounded-[3px] border border-grade">
          <Table className="cartoes">
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead><TableHead>Fornecedor</TableHead><TableHead>Documento</TableHead><TableHead>Histórico</TableHead>
                <TableHead>Conta de fluxo</TableHead><TableHead>Vencimento</TableHead><TableHead className="text-right">Valor</TableHead>
                <TableHead>Classificação</TableHead><TableHead>Motivo</TableHead><TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lancs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.empresa_nome}</TableCell>
                  <TableCell>{l.cod_fornecedor}{l.nome_fornecedor ? ` · ${l.nome_fornecedor}` : ""}</TableCell>
                  <TableCell>{l.num_documento} <span className="text-xs text-muted-foreground">({l.tipo_lancamento} {l.cod_lancamento})</span></TableCell>
                  <TableCell>{l.complemento ?? "—"}</TableCell>
                  <TableCell>{contaFluxo(l.grupo, l.conta)}</TableCell>
                  <TableCell>{formatarData(l.data_vencimento) || "—"}</TableCell>
                  <TableCell className="text-right">{moeda(l.valor_documento)}</TableCell>
                  <TableCell>{ROTULO_CLASSIFICACAO[l.classificacao]}{l.natureza_nome ? ` · ${l.natureza_nome}` : ""}</TableCell>
                  <TableCell className="text-xs">{l.motivo ?? l.regra_nome ?? "—"}</TableCell>
                  <TableCell>
                    {operador && (
                      <div className="flex flex-wrap gap-1">
                        {l.classificacao.startsWith("manual_") ? <BotaoDevolver id={l.id} /> : !l.parcela_id && <ClassificarLancamento id={l.id} naturezas={apoio.naturezas} />}
                        {l.parcela_id && l.parcelamento_id && <Link className="text-xs underline" href={`${ROTA_PARCELAMENTOS}/${l.parcelamento_id}`}>{l.parcelamento_descricao}</Link>}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
