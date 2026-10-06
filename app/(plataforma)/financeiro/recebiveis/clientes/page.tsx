import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RecebiveisAbas } from "../abas-recebiveis";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { emCentavos, formatarMoeda } from "@/lib/modulos/financeiro/recebiveis/carteira";
import { DIAS_ESCOPO_CADASTRO, titulaNoEscopoDeCadastro } from "@/lib/modulos/financeiro/recebiveis/clientes";
import { formatarWhatsapp } from "@/lib/nucleo/documentos";
import { sanitizarBusca } from "@/lib/nucleo/erros";
import { temAcesso } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { ROTULO_UNIDADE } from "@/supabase/functions/_shared/cobranca";
import { temContatoUtil, type ContatoEscolha } from "@/supabase/functions/_shared/contatos";

export const metadata: Metadata = { title: "Clientes e contatos" };

const MODULO = "financeiro.recebiveis";
const POR_PAGINA = 50;
const ABAS = ["cadastrar", "sem_contato", "todos"] as const;
type Aba = (typeof ABAS)[number];
const ROTULO_ABA: Record<Aba, string> = { cadastrar: "Para cadastrar agora", sem_contato: "Sem contato", todos: "Todos os clientes em aberto" };
const EXPLICACAO: Record<Aba, string> = {
  cadastrar: `Clientes de Cuiabá (Matriz) com título a vencer ou vencido há menos de ${DIAS_ESCOPO_CADASTRO} dias e sem nenhum contato. É esta a lista combinada para cadastrar agora.`,
  sem_contato: "Todos os clientes com título em aberto que ainda não têm e-mail, WhatsApp nem telefone cadastrado (inclui os antigos e os da Filial Contagem, que ficam para outro momento).",
  todos: "Todos os clientes que têm título em aberto, com ou sem contato.",
};

const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

type TituloAberto = { contraparte_id: string; unidade: string; valor: number | string; dias_atraso: number; faixa: string };
type LinhaCliente = {
  id: string; nome: string; codigo: string | null; documento: string | null;
  titulos: number; centavos: number; maxAtraso: number; unidades: Set<"matriz" | "contagem">;
  contatos: ContatoEscolha[]; noEscopo: boolean; temContato: boolean;
};

export default async function PaginaClientes({ searchParams }: PageProps<"/financeiro/recebiveis/clientes">) {
  const sessao = await exigirSessao();
  const modulo = sessao.modulos.find((m) => m.codigo === MODULO);
  if (!modulo || !modulo.ativo || !temAcesso(sessao.acesso, "financeiro")) notFound();

  const parametros = await searchParams;
  const abaPedida = primeiro(parametros.aba);
  const aba: Aba = (ABAS as readonly string[]).includes(abaPedida) ? (abaPedida as Aba) : "cadastrar";
  const busca = sanitizarBusca(primeiro(parametros.q));
  const pagina = Math.max(1, Number.parseInt(primeiro(parametros.pagina), 10) || 1);

  const supabase = await criarClienteServidor();

  // Todos os títulos em aberto (PostgREST devolve até 1000 por vez), agrupados por cliente.
  const abertos: TituloAberto[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from("rec_vw_titulos").select("contraparte_id, unidade, valor, dias_atraso, faixa").neq("faixa", "encerrado").order("id").range(de, de + 999);
    if (error) throw new Error(`Falha ao ler a carteira: ${error.message}`);
    abertos.push(...((data ?? []) as TituloAberto[]));
    if (!data || data.length < 1000) break;
  }
  const porCliente = new Map<string, LinhaCliente>();
  for (const t of abertos) {
    const l = porCliente.get(t.contraparte_id) ?? {
      id: t.contraparte_id, nome: "", codigo: null, documento: null, titulos: 0, centavos: 0, maxAtraso: 0, unidades: new Set(), contatos: [], noEscopo: false, temContato: false,
    };
    l.titulos++;
    l.centavos += emCentavos(t.valor);
    l.maxAtraso = Math.max(l.maxAtraso, t.dias_atraso);
    l.unidades.add(t.unidade === "contagem" ? "contagem" : "matriz");
    if (titulaNoEscopoDeCadastro(t)) l.noEscopo = true;
    porCliente.set(t.contraparte_id, l);
  }

  const ids = [...porCliente.keys()];
  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100);
    const [{ data: clientes }, { data: contatos }] = await Promise.all([
      supabase.from("contrapartes").select("id, nome, codigo_erp, documento").in("id", lote),
      supabase.from("contatos").select("id, contraparte_id, nome, email, whatsapp, telefone, finalidades, ativo").in("contraparte_id", lote).eq("ativo", true),
    ]);
    for (const c of clientes ?? []) {
      const l = porCliente.get(c.id as string)!;
      l.nome = c.nome as string;
      l.codigo = (c.codigo_erp as string | null) ?? null;
      l.documento = (c.documento as string | null) ?? null;
    }
    for (const c of contatos ?? []) porCliente.get(c.contraparte_id as string)?.contatos.push(c as unknown as ContatoEscolha);
  }
  for (const l of porCliente.values()) l.temContato = temContatoUtil(l.contatos);

  const todos = [...porCliente.values()];
  const contagens: Record<Aba, number> = {
    cadastrar: todos.filter((l) => l.noEscopo && !l.temContato).length,
    sem_contato: todos.filter((l) => !l.temContato).length,
    todos: todos.length,
  };
  const termo = busca.toLowerCase();
  const filtrados = todos
    .filter((l) => (aba === "cadastrar" ? l.noEscopo && !l.temContato : aba === "sem_contato" ? !l.temContato : true))
    .filter((l) => !termo || l.nome.toLowerCase().includes(termo) || (l.codigo ?? "").toLowerCase().includes(termo) || (l.documento ?? "").includes(termo))
    // Quem mais precisa de contato primeiro: sem contato e no escopo, depois os mais atrasados dentro do escopo, depois por nome.
    .sort((a, b) => Number(b.noEscopo && !b.temContato) - Number(a.noEscopo && !a.temContato) || Number(a.temContato) - Number(b.temContato) || a.nome.localeCompare(b.nome, "pt-BR"));
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const pagina_ = Math.min(pagina, totalPaginas);
  const linhas = filtrados.slice((pagina_ - 1) * POR_PAGINA, pagina_ * POR_PAGINA);

  const href = (extra: { aba?: Aba; pagina?: number }) => {
    const qs = new URLSearchParams();
    const a = extra.aba ?? aba;
    if (a !== "cadastrar") qs.set("aba", a);
    if (busca && extra.aba === undefined) qs.set("q", busca);
    if (extra.pagina && extra.pagina > 1) qs.set("pagina", String(extra.pagina));
    const texto = qs.toString();
    return `/financeiro/recebiveis/clientes${texto ? `?${texto}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" render={<Link href="/financeiro/recebiveis" />}><ArrowLeft /> Voltar à carteira</Button>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clientes e contatos</h1>
        <p className="text-sm text-muted-foreground">
          Onde se cadastram os contatos (e-mail, WhatsApp e telefone) de quem recebe o boleto, a confirmação e a cobrança. Clique em <strong>Cadastrar contato</strong> na linha do cliente
          {" "}ou abra a ficha dele. Os contatos também podem ser cadastrados direto nas telas de boleto, cobrança e confirmação.
        </p>
      </div>

      <RecebiveisAbas ativa="clientes" contagens={{ clientes: contagens.cadastrar }} />

      <nav aria-label="Lista" className="flex flex-wrap gap-px overflow-hidden rounded-[3px] border border-grade bg-grade">
        {ABAS.map((a) => {
          const ativa = a === aba;
          return (
            <Link key={a} href={href({ aba: a })} aria-current={ativa ? "page" : undefined} className={`min-w-48 flex-1 px-3 py-1.5 ${ativa ? "border-b-2 border-marca bg-white" : "bg-cabecalho hover:bg-white"}`}>
              <span className={`flex items-center justify-between gap-2 text-[12px] ${ativa ? "font-bold" : ""}`}>
                {ROTULO_ABA[a]}
                <span className="rounded-[3px] bg-white px-1.5 text-[11px] font-bold tabular-nums ring-1 ring-grade">{contagens[a]}</span>
              </span>
            </Link>
          );
        })}
      </nav>
      <p className="text-[12px] text-muted-foreground">{EXPLICACAO[aba]}</p>

      <form method="get" className="flex flex-wrap items-center gap-2" role="search">
        {aba !== "cadastrar" && <input type="hidden" name="aba" value={aba} />}
        <Input name="q" defaultValue={busca} placeholder="Cliente, código ou CPF/CNPJ" aria-label="Buscar" className="w-72" />
        <Button type="submit" variant="secondary">Filtrar</Button>
        {busca && <Button variant="ghost" render={<Link href={href({ pagina: 1 }).replace(/[?&]q=[^&]*/, "")} />}>Limpar</Button>}
      </form>

      {linhas.length === 0 ? (
        <p className="rounded-[3px] border border-dashed p-8 text-center text-sm text-muted-foreground">
          {busca ? "Nenhum cliente encontrado com essa busca." : aba === "cadastrar" ? "Nenhum cliente para cadastrar agora. Tudo certo." : "Nenhum cliente nesta lista."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[3px] border border-grade">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead className="text-right">Títulos em aberto</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => {
                const primeiroContato = l.contatos[0];
                return (
                  <TableRow key={l.id}>
                    <TableCell className="max-w-80 truncate font-medium" title={l.nome}>
                      <Link href={`/financeiro/recebiveis/clientes/${l.id}`} className="hover:underline">{l.nome || "—"}</Link>
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{l.codigo ?? "—"}</TableCell>
                    <TableCell className="space-x-1">
                      {[...l.unidades].map((u) => <Badge key={u} variant={u === "contagem" ? "default" : "secondary"}>{ROTULO_UNIDADE[u]}</Badge>)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.titulos} · {formatarMoeda(l.centavos)}
                      {l.maxAtraso > 0 && <span className="block text-[11px] text-red-700">atraso máx. {l.maxAtraso} dias</span>}
                    </TableCell>
                    <TableCell className="text-[12px] leading-tight">
                      {l.temContato && primeiroContato ? (
                        <>
                          <span className="block font-medium">{primeiroContato.nome}{l.contatos.length > 1 ? ` +${l.contatos.length - 1}` : ""}</span>
                          <span className="block text-muted-foreground">{[primeiroContato.email, primeiroContato.whatsapp ? formatarWhatsapp(primeiroContato.whatsapp) : null, primeiroContato.telefone ? formatarWhatsapp(primeiroContato.telefone) : null].filter(Boolean).join(" · ")}</span>
                        </>
                      ) : (
                        <Badge variant="outline" className="border-marca text-marca">Sem contato</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant={l.temContato ? "outline" : "default"} size="sm" render={<Link href={`/financeiro/recebiveis/clientes/${l.id}`} />}>
                        {l.temContato ? "Contatos" : "Cadastrar contato"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{filtrados.length} {filtrados.length === 1 ? "cliente" : "clientes"}{busca ? " na busca" : ""}</span>
        {totalPaginas > 1 && (
          <span className="flex items-center gap-2">
            {pagina_ > 1 && <Button variant="outline" size="sm" render={<Link href={href({ pagina: pagina_ - 1 })} />}>Anterior</Button>}
            Página {pagina_} de {totalPaginas}
            {pagina_ < totalPaginas && <Button variant="outline" size="sm" render={<Link href={href({ pagina: pagina_ + 1 })} />}>Próxima</Button>}
          </span>
        )}
      </div>
    </div>
  );
}
