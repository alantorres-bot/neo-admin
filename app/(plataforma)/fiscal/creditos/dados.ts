// Leituras compartilhadas do Fiscal Control (RLS de quem consulta: só as empresas do escopo do usuário).
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { notFound } from "next/navigation";
import { MODULO_CREDITOS, type Papel } from "@/lib/modulos/fiscal/creditos/modulo";
import { temAcessoModulo } from "@/lib/nucleo/permissoes";
import { exigirSessao } from "@/lib/nucleo/sessao";
import { criarClienteServidor } from "@/lib/supabase/servidor";

export type Cliente = SupabaseClient;
export type Opcao = { id: string; nome: string };
export type Estabelecimento = { id: string; empresa_id: string; nome: string; cnpj: string; uf: string | null; matriz: boolean; ativo: boolean; ficticio: boolean };
export type Tributo = { id: string; codigo: string; nome: string; esfera: string; ativo: boolean; observacao: string | null };
export type Categoria = {
  id: string; codigo: string; nome: string; tributo_id: string | null; natureza: string; formas_utilizacao: string[]; prazo_aproveitamento_meses: number | null;
  exige_processo: boolean; documentos_exigidos: string[]; regra_validada: boolean; observacao_legal: string | null; ativo: boolean;
};
export type TipoMovimento = { codigo: string; nome: string; classe: string; sinal: number; forma: string | null; exige_aprovacao: boolean; exige_protocolo: boolean; sistema: boolean; ativo: boolean };
export type TipoObrigacao = {
  id: string; codigo: string; nome: string; tributo_id: string | null; esfera: string; periodicidade: string; dia_vencimento: number | null; meses_apos: number;
  regra_vencimento_validada: boolean; fonte_regra: string | null; exige_recibo: boolean; documentos_exigidos: string[]; descricao: string | null; ativo: boolean;
};

export type Cadastros = {
  empresas: Opcao[]; estabelecimentos: Estabelecimento[]; tributos: Tributo[]; categorias: Categoria[]; origens: { codigo: string; nome: string }[];
  tiposMovimento: TipoMovimento[]; tiposDocumento: { codigo: string; nome: string }[]; tiposObrigacao: TipoObrigacao[]; usuarios: Opcao[];
};

/** Sessão + cliente + papel no módulo (fis_papel_atual). Cada página chama perto dos dados. */
export const contexto = cache(async () => {
  const sessao = await exigirSessao();
  if (!temAcessoModulo(sessao.acesso, sessao.modulos, MODULO_CREDITOS)) notFound();
  const supabase = await criarClienteServidor();
  const [{ data }, { data: chave }] = await Promise.all([
    supabase.rpc("fis_papel_atual"),
    supabase.from("configuracoes").select("valor").eq("chave", "fiscal.creditos.permitir_autoaprovacao").maybeSingle(),
  ]);
  const papel = (data as Papel | null) ?? null;
  // Exceção à segregação (migration 0204): o Administrador valida/aprova o que ele mesmo lançou, com justificativa.
  const autoaprova = papel === "administrador" && chave?.valor === true;
  return { sessao, supabase, papel, autoaprova };
});

export const lerCadastros = cache(async (): Promise<Cadastros> => {
  const { supabase } = await contexto();
  const [empresas, estabs, tributos, categorias, origens, tiposMov, tiposDoc, tiposObr, usuarios] = await Promise.all([
    supabase.from("empresas").select("id, nome_curto").order("nome_curto"),
    supabase.from("fis_estabelecimentos").select("id, empresa_id, nome, cnpj, uf, matriz, ativo, ficticio").order("nome"),
    supabase.from("fis_tributos").select("id, codigo, nome, esfera, ativo, observacao").order("codigo"),
    supabase.from("fis_categorias").select("id, codigo, nome, tributo_id, natureza, formas_utilizacao, prazo_aproveitamento_meses, exige_processo, documentos_exigidos, regra_validada, observacao_legal, ativo").order("nome"),
    supabase.from("fis_origens").select("codigo, nome").eq("ativo", true).order("nome"),
    supabase.from("fis_tipos_movimento").select("codigo, nome, classe, sinal, forma, exige_aprovacao, exige_protocolo, sistema, ativo").order("nome"),
    supabase.from("fis_tipos_documento").select("codigo, nome").eq("ativo", true).order("nome"),
    supabase.from("fis_tipos_obrigacao").select("id, codigo, nome, tributo_id, esfera, periodicidade, dia_vencimento, meses_apos, regra_vencimento_validada, fonte_regra, exige_recibo, documentos_exigidos, descricao, ativo").order("nome"),
    supabase.from("perfis").select("id, nome").eq("ativo", true).order("nome"),
  ]);
  const estabelecimentos = (estabs.data ?? []) as Estabelecimento[];
  // Empresas do escopo: as que têm estabelecimento visível (a RLS de fis_estabelecimentos já filtra pelo escopo).
  const comEstab = new Set(estabelecimentos.map((e) => e.empresa_id));
  return {
    empresas: (empresas.data ?? []).filter((e) => comEstab.has(e.id)).map((e) => ({ id: e.id as string, nome: e.nome_curto as string })),
    estabelecimentos,
    tributos: (tributos.data ?? []) as Tributo[],
    categorias: (categorias.data ?? []) as Categoria[],
    origens: (origens.data ?? []) as { codigo: string; nome: string }[],
    tiposMovimento: (tiposMov.data ?? []) as TipoMovimento[],
    tiposDocumento: (tiposDoc.data ?? []) as { codigo: string; nome: string }[],
    tiposObrigacao: (tiposObr.data ?? []) as TipoObrigacao[],
    usuarios: (usuarios.data ?? []).map((u) => ({ id: u.id as string, nome: u.nome as string })),
  };
});

/** Mapa id → rótulo para exibir nomes nas grades. */
export function nomes(c: Cadastros) {
  const m = <T,>(lista: T[], id: (x: T) => string, nome: (x: T) => string) => new Map(lista.map((x) => [id(x), nome(x)]));
  return {
    empresa: m(c.empresas, (x) => x.id, (x) => x.nome),
    estab: m(c.estabelecimentos, (x) => x.id, (x) => x.nome),
    tributo: m(c.tributos, (x) => x.id, (x) => x.codigo),
    categoria: m(c.categorias, (x) => x.id, (x) => x.nome),
    origem: m(c.origens, (x) => x.codigo, (x) => x.nome),
    tipoMov: m(c.tiposMovimento, (x) => x.codigo, (x) => x.nome),
    tipoDoc: m(c.tiposDocumento, (x) => x.codigo, (x) => x.nome),
    tipoObr: m(c.tiposObrigacao, (x) => x.id, (x) => x.nome),
    usuario: m(c.usuarios, (x) => x.id, (x) => x.nome),
  };
}

export type Filtros = { empresa: string; estab: string; tributo: string; ano: number; mes: number | null; validacao: string; status: string; busca: string; pagina: number };

const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const uuid = (v: string) => (/^[0-9a-f-]{36}$/i.test(v) ? v : "");

export function lerFiltros(p: Record<string, string | string[] | undefined>, anoPadrao: number): Filtros {
  const ano = Number(texto(p.ano));
  const mes = Number(texto(p.mes));
  const pagina = Number(texto(p.pagina));
  return {
    empresa: uuid(texto(p.empresa)), estab: uuid(texto(p.estab)), tributo: uuid(texto(p.tributo)),
    ano: Number.isInteger(ano) && ano >= 2000 && ano <= 2100 ? ano : anoPadrao,
    mes: Number.isInteger(mes) && mes >= 1 && mes <= 12 ? mes : null,
    validacao: /^[a-z_]{3,30}$/.test(texto(p.validacao)) ? texto(p.validacao) : "",
    status: /^[a-z_]{3,30}$/.test(texto(p.status)) ? texto(p.status) : "",
    busca: texto(p.busca).slice(0, 80),
    pagina: Number.isInteger(pagina) && pagina >= 1 ? pagina : 1,
  };
}

/** Monta a query string mantendo os filtros (troca o que vier em `mudar`). */
type Params = Record<string, string | number | null | undefined>;
export function comFiltros(rota: string, f: Params, mudar: Params = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...mudar })) if (v !== null && v !== undefined && v !== "" && !(k === "pagina" && v === 1)) p.set(k, String(v));
  const qs = p.toString();
  return qs ? `${rota}?${qs}` : rota;
}

export type Comentario = { id: string; texto: string; autor_id: string | null; criado_em: string };
export type Decisao = { id: number; decisao: string; justificativa: string | null; usuario_id: string | null; em: string; dados: unknown };
export type DocumentoVinculado = {
  vinculo_id: string; documento_id: string; tipo: string; titulo: string; versao: number; situacao: string; nome_arquivo: string | null; ficticio: boolean; enviado_em: string;
};

export async function lerHistorico(supabase: Cliente, alvo: string, id: string) {
  const [com, dec, docs] = await Promise.all([
    supabase.from("fis_comentarios").select("id, texto, autor_id, criado_em").eq("alvo", alvo).eq("alvo_id", id).order("criado_em"),
    supabase.from("fis_decisoes").select("id, decisao, justificativa, usuario_id, em, dados").eq("alvo", alvo).eq("alvo_id", id).order("id"),
    supabase.from("fis_documentos_vinculos").select("id, documento:fis_documentos(id, tipo, titulo, versao, situacao, nome_arquivo, ficticio, enviado_em)")
      .eq("alvo", alvo).eq("alvo_id", id).is("removido_em", null),
  ]);
  const documentos = (docs.data ?? []).map((v) => {
    const d = (Array.isArray(v.documento) ? v.documento[0] : v.documento) as Omit<DocumentoVinculado, "vinculo_id" | "documento_id"> & { id: string };
    return { vinculo_id: v.id as string, documento_id: d.id, tipo: d.tipo, titulo: d.titulo, versao: d.versao, situacao: d.situacao, nome_arquivo: d.nome_arquivo, ficticio: d.ficticio, enviado_em: d.enviado_em };
  }).filter((d) => d.situacao === "vigente");
  return { comentarios: (com.data ?? []) as Comentario[], decisoes: (dec.data ?? []) as Decisao[], documentos: documentos as DocumentoVinculado[] };
}
