import type { Metadata } from "next";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dataHora } from "@/lib/modulos/fiscal/creditos/formatos";
import { CAMPOS, type TipoImportacao } from "@/lib/modulos/fiscal/creditos/importacao";
import { pode, ROTA_CREDITOS } from "@/lib/modulos/fiscal/creditos/modulo";
import { confirmarImportacao, descartarImportacao } from "../acoes";
import { Indicador, Secao, Selo, Vazio } from "../componentes";
import { contexto, lerCadastros, nomes } from "../dados";
import { BotaoAcao } from "../ui";
import { Assistente } from "./assistente";

export const metadata: Metadata = { title: "Importação" };

const TOM: Record<string, "bom" | "grave" | "atencao" | "neutro" | "info"> = { valida: "info", erro: "grave", duplicada: "atencao", importada: "bom", rejeitada: "grave" };

export default async function PaginaImportacao({ searchParams }: PageProps<"/fiscal/creditos/importacao">) {
  const { supabase, papel } = await contexto();
  const sp = await searchParams;
  const tipo: TipoImportacao = sp.tipo === "movimentos" ? "movimentos" : "creditos";
  const loteId = typeof sp.lote === "string" && /^[0-9a-f-]{36}$/i.test(sp.lote) ? sp.lote : "";
  const cad = await lerCadastros();
  const n = nomes(cad);
  if (!pode(papel, "lancar")) return <Vazio titulo="Importação disponível para analista fiscal, revisor, contador ou administrador." />;
  const [{ data: lotes }, lote, { data: linhas }] = await Promise.all([
    supabase.from("fis_imp_lotes").select("*").order("criado_em", { ascending: false }).limit(20),
    loteId ? supabase.from("fis_imp_lotes").select("*").eq("id", loteId).maybeSingle() : Promise.resolve({ data: null }),
    loteId ? supabase.from("fis_imp_linhas").select("id, linha, dados, erros, status, mensagem, registro_id").eq("lote_id", loteId).order("linha") : Promise.resolve({ data: [] }),
  ]);
  const l = lote.data;
  const campos = l ? CAMPOS[l.tipo as TipoImportacao] : [];

  return (
    <div className="space-y-4">
      <Secao titulo="Importar planilha" descricao="1) Baixe o modelo ou use a sua planilha · 2) confira o mapeamento e valide · 3) revise a prévia e confirme. As linhas válidas entram pelas mesmas regras do cadastro manual.">
        <Assistente tipoInicial={tipo} />
        <p className="mt-2 text-xs text-muted-foreground">Formatos suportados: XLSX, XLS e CSV (primeira aba, cabeçalho na 1ª linha). Arquivos SPED/XML não são importados como créditos; a EFD ICMS/IPI só é lida para o saldo oficial (Apuração mensal).</p>
      </Secao>

      {l && (
        <Secao titulo={`Prévia: ${l.arquivo_nome} (${l.tipo === "creditos" ? "créditos" : "movimentações"})`} descricao={`Validado em ${dataHora(l.criado_em)} por ${n.usuario.get(l.criado_por) ?? "—"} · situação: ${l.status}`}
          acoes={l.status === "validado" ? <>
            <BotaoAcao rotulo={`Confirmar importação de ${l.validas} linha(s)`} variante="default" acao={confirmarImportacao} campos={{ id: l.id }}
              confirmar={`Importar ${l.validas} linha(s) válida(s)? Linhas com erro e duplicadas ficam de fora.`} />
            <BotaoAcao rotulo="Descartar" acao={descartarImportacao} campos={{ id: l.id }} confirmar="Descartar o lote sem importar nada?" />
          </> : undefined}>
          <div className="mb-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Indicador rotulo="Linhas" valor={l.total} />
            <Indicador rotulo="Válidas" valor={l.validas} tom="info" />
            <Indicador rotulo="Com erro" valor={l.com_erro} tom={l.com_erro ? "grave" : "neutro"} />
            <Indicador rotulo="Duplicadas" valor={l.duplicadas} tom={l.duplicadas ? "atencao" : "neutro"} />
            {l.status === "confirmado" && <Indicador rotulo="Importadas" valor={l.importadas ?? 0} tom="bom" />}
            {l.status === "confirmado" && <Indicador rotulo="Rejeitadas na confirmação" valor={l.rejeitadas ?? 0} tom={l.rejeitadas ? "grave" : "neutro"} />}
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Linha</TableHead><TableHead>Situação</TableHead>{campos.slice(0, 7).map((c) => <TableHead key={c.chave}>{c.titulo}</TableHead>)}<TableHead>Erros / resultado</TableHead></TableRow></TableHeader>
            <TableBody>
              {(linhas ?? []).map((x) => (
                <TableRow key={x.id}>
                  <TableCell>{x.linha}</TableCell>
                  <TableCell><Selo tom={TOM[x.status]}>{x.status}</Selo></TableCell>
                  {campos.slice(0, 7).map((c) => <TableCell key={c.chave} className="max-w-40 truncate">{String((x.dados as Record<string, unknown>)[c.chave] ?? "")}</TableCell>)}
                  <TableCell className="max-w-md whitespace-normal text-xs">
                    {(x.erros as string[]).join(" ")} {x.mensagem}
                    {x.registro_id && l.tipo === "creditos" && <Link className="text-elo hover:underline" href={`${ROTA_CREDITOS}/creditos/${x.registro_id}`}>abrir crédito</Link>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Secao>
      )}

      <Secao titulo="Importações recentes">
        {(lotes ?? []).length === 0 ? <Vazio titulo="Nenhuma importação ainda" /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Arquivo</TableHead><TableHead>Tipo</TableHead><TableHead>Quando</TableHead><TableHead>Quem</TableHead><TableHead>Situação</TableHead><TableHead className="text-right">Válidas</TableHead><TableHead className="text-right">Erro</TableHead><TableHead className="text-right">Duplicadas</TableHead><TableHead className="text-right">Importadas</TableHead></TableRow></TableHeader>
            <TableBody>
              {(lotes ?? []).map((x) => (
                <TableRow key={x.id}>
                  <TableCell><Link className="text-elo hover:underline" href={`${ROTA_CREDITOS}/importacao?lote=${x.id}`}>{x.arquivo_nome}</Link></TableCell>
                  <TableCell>{x.tipo}</TableCell><TableCell>{dataHora(x.criado_em)}</TableCell><TableCell>{n.usuario.get(x.criado_por) ?? "—"}</TableCell>
                  <TableCell>{x.status}</TableCell><TableCell className="text-right">{x.validas}</TableCell><TableCell className="text-right">{x.com_erro}</TableCell>
                  <TableCell className="text-right">{x.duplicadas}</TableCell><TableCell className="text-right">{x.importadas ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Secao>
    </div>
  );
}
