// Edge Function do módulo Financeiro/Recebíveis: sincroniza as contas a receber em aberto do Consistem.
// Mesma API já em produção no gestor-akf e no NEOControl (ver _shared/consistem-receber.ts).
//
// Quem pode chamar:
//   - usuário logado com nível de gestor (ou acima) na área do Financeiro; ou
//   - agendamento (pg_cron) com a service role no Authorization.
//
// Corpo (JSON), campo `acao`:
//   sincronizar { simular?: boolean }   busca a API e grava; com simular=true só devolve o que faria
//   amostra                             devolve os NOMES e tipos dos campos da API (sem valores) para conferência
//
// Regras de segurança dos dados:
//   - A API só lista títulos EM ABERTO. Título que sumiu da lista NÃO é baixado: vira pendência
//     "Possível baixa" na Fila do dia, para um humano confirmar data e valor.
//   - Se a API devolver lista vazia mas existem títulos abertos no banco, nada é alterado (provável falha).
//   - Títulos pagos/renegociados/cancelados e de origem manual/acordo nunca são alterados por aqui.
//
// Segredos (Supabase > Edge Functions > Secrets): CONSISTEM_API_KEY (obrigatório),
// CONSISTEM_BASE_URL (opcional). O código da empresa vem de empresas.codigo_erp.
//
// Deploy: npx supabase functions deploy rec-sincronizar-consistem
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  BASE_URL_PADRAO,
  buscarTodasPaginas,
  ConsistemErro,
  documentoFormatado,
  normalizarClienteApi,
  normalizarTituloApi,
  PAGINACAO,
  planejarSincronizacao,
  type ClienteApi,
  type ConfigConsistem,
  type TituloApi,
  type TituloBanco,
} from "../_shared/consistem-receber.ts";

const MODULO = "financeiro.recebiveis";
const PREFIXO_BAIXA = "Possível baixa: ";
const LOTE = 200;

const CABECALHOS = { "Content-Type": "application/json; charset=utf-8" };
const responder = (corpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: CABECALHOS });

function iguaisSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * O chamador é a service role (agendamento)? Igualdade com a chave injetada resolve o caso comum; como o projeto
 * pode ter chaves nos dois formatos (legada JWT e nova sb_secret_), a prova final é uma operação administrativa do
 * Auth, que só uma service role válida consegue fazer (um JWT forjado com role=service_role falha na assinatura).
 */
async function ehServiceRole(url: string, portador: string, chaveServico: string): Promise<boolean> {
  if (portador === "") return false;
  if (iguaisSeguro(portador, chaveServico)) return true;
  const pareceChaveDeServico = portador.startsWith("sb_secret_") || (() => {
    try {
      const carga = JSON.parse(atob(portador.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return carga.role === "service_role";
    } catch {
      return false;
    }
  })();
  if (!pareceChaveDeServico) return false;
  const tentativa = createClient(url, portador, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await tentativa.auth.admin.listUsers({ page: 1, perPage: 1 });
  return !error;
}

function lotes<T>(itens: T[], tamanho = LOTE): T[][] {
  const saida: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) saida.push(itens.slice(i, i + tamanho));
  return saida;
}

// deno-lint-ignore no-explicit-any
type Banco = SupabaseClient<any, "public", any>;

/** PostgREST devolve no máximo 1000 linhas por consulta: lê tudo em páginas. */
// deno-lint-ignore no-explicit-any
async function lerTudo<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: any[] | null; error: { message: string } | null }>): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    saida.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return saida;
  }
}

type ContraparteLinha = { id: string; nome: string; documento: string | null; codigo_erp: string | null; tipos: string[] };

async function resolverContrapartes(
  banco: Banco,
  codigos: string[],
  clientes: Map<string, ClienteApi>,
  contagem: { contrapartesNovas: number; contrapartesVinculadas: number; documentosInvalidos: number },
): Promise<Map<string, string>> {
  const existentes = await lerTudo<ContraparteLinha>((de, ate) =>
    banco.from("contrapartes").select("id, nome, documento, codigo_erp, tipos").order("id").range(de, ate));
  const porCodigo = new Map(existentes.filter((c) => c.codigo_erp).map((c) => [c.codigo_erp as string, c]));
  const porDocumento = new Map(existentes.filter((c) => c.documento).map((c) => [c.documento as string, c]));
  const resultado = new Map<string, string>();
  const paraCriar: { nome: string; documento: string | null; tipos: string[]; codigo_erp: string }[] = [];
  const documentosUsados = new Set<string>();

  for (const cod of codigos) {
    const noCodigo = porCodigo.get(cod);
    if (noCodigo) {
      resultado.set(cod, noCodigo.id);
      continue;
    }
    const cli = clientes.get(cod);
    const documento = cli?.documentoBruto ? documentoFormatado(cli.documentoBruto) : null;
    if (cli?.documentoBruto && !documento) contagem.documentosInvalidos++;

    // Cadastro já existe (criado à mão ou por outro módulo) com o mesmo CPF/CNPJ: só liga ao código do Consistem.
    const noDocumento = documento ? porDocumento.get(documento) : undefined;
    if (noDocumento && !noDocumento.codigo_erp) {
      const tipos = noDocumento.tipos.includes("cliente") || noDocumento.tipos.includes("colaborador")
        ? noDocumento.tipos
        : [...noDocumento.tipos.filter((t) => t !== "outro"), "cliente"];
      const { error } = await banco.from("contrapartes").update({ codigo_erp: cod, tipos }).eq("id", noDocumento.id);
      if (error) throw new Error(`Falha ao vincular o cliente ${cod}: ${error.message}`);
      resultado.set(cod, noDocumento.id);
      contagem.contrapartesVinculadas++;
      continue;
    }

    // Documento repetido dentro desta mesma rodada (dois códigos com o mesmo CNPJ) ou já de outro cadastro: sem documento.
    const documentoLivre = documento && !noDocumento && !documentosUsados.has(documento) ? documento : null;
    if (documentoLivre) documentosUsados.add(documentoLivre);
    paraCriar.push({ nome: cli?.nome || `Cliente ${cod} (Consistem)`, documento: documentoLivre, tipos: ["cliente"], codigo_erp: cod });
  }

  for (const lote of lotes(paraCriar)) {
    const { data, error } = await banco.from("contrapartes").insert(lote).select("id, codigo_erp");
    if (error) throw new Error(`Falha ao criar clientes: ${error.message}`);
    for (const c of data ?? []) resultado.set(c.codigo_erp as string, c.id as string);
    contagem.contrapartesNovas += lote.length;
  }
  return resultado;
}

type ResumoEmpresa = Record<string, unknown>;

async function sincronizarEmpresa(
  banco: Banco,
  empresa: { id: string; nome_curto: string; codigo_erp: string },
  cfgBase: Omit<ConfigConsistem, "empresa">,
  simular: boolean,
  usuarioId: string | null,
): Promise<ResumoEmpresa> {
  const cfg: ConfigConsistem = { ...cfgBase, empresa: empresa.codigo_erp };
  const buscar = (url: string, init: { headers: Record<string, string> }) => fetch(url, init);

  // 1) API
  const registros = await buscarTodasPaginas(buscar, cfg, "financeiro/v10/contasReceber", { tipoTitulo: 0, paginacao: PAGINACAO });
  const titulosApi: TituloApi[] = [];
  const recusados: { documento: string; motivo: string }[] = [];
  for (const r of registros) {
    const n = normalizarTituloApi(r);
    if (n.ok) titulosApi.push(n.titulo);
    else recusados.push({ documento: n.documento, motivo: n.motivo });
  }

  // 2) Banco
  type LinhaTitulo = {
    id: string; contraparte_id: string; documento: string; parcela: string; emissao: string | null;
    vencimento: string; valor: number | string; estagio: string; origem: string;
  };
  const linhas = await lerTudo<LinhaTitulo>((de, ate) =>
    banco.from("rec_titulos")
      .select("id, contraparte_id, documento, parcela, emissao, vencimento, valor, estagio, origem")
      .eq("empresa_id", empresa.id).order("id").range(de, ate));
  const titulosBanco: TituloBanco[] = linhas.map((l) => ({
    id: l.id, documento: l.documento, parcela: l.parcela, emissao: l.emissao, vencimento: l.vencimento,
    valorCentavos: Math.round(Number(l.valor) * 100), estagio: l.estagio, origem: l.origem,
  }));
  const contraparteDoTitulo = new Map(linhas.map((l) => [l.id, l.contraparte_id]));

  // Trava de segurança: lista vazia da API com títulos abertos no banco = provável falha, não "todos pagaram".
  const abertosDoConsistem = titulosBanco.filter((t) => t.origem === "importacao" && !["pago", "renegociado", "cancelado"].includes(t.estagio)).length;
  if (titulosApi.length === 0 && abertosDoConsistem > 0) {
    throw new Error(`A API devolveu nenhum título válido, mas há ${abertosDoConsistem} abertos no banco. Nada foi alterado.`);
  }

  const plano = planejarSincronizacao(titulosApi, titulosBanco);
  const resumo: ResumoEmpresa = {
    empresa: empresa.nome_curto,
    titulosNaApi: registros.length,
    novos: plano.novos.length,
    alterados: plano.alterados.length,
    inalterados: plano.inalterados,
    possiveisBaixas: plano.possiveisBaixas.length,
    divergentes: plano.divergentes.length,
    recusados: recusados.length,
    duplicadosNaApi: plano.duplicadosApi.length,
    exemplosRecusados: recusados.slice(0, 5),
    // Conferência de leitura dos valores (só agregados, sem dados de cliente).
    valorTotalApi: titulosApi.reduce((s, t) => s + t.valorCentavos, 0) / 100,
    maiorValorApi: titulosApi.reduce((m, t) => Math.max(m, t.valorCentavos), 0) / 100,
    vencidosNaApi: titulosApi.filter((t) => t.vencimento < new Date().toISOString().slice(0, 10)).length,
    clientesDistintos: new Set(titulosApi.map((t) => t.codCliente)).size,
    simulacao: simular,
  };
  if (simular) return resumo;

  // 3) Clientes: só os que têm título novo.
  const codigosNovos = [...new Set(plano.novos.map((t) => t.codCliente))];
  const contagem = { contrapartesNovas: 0, contrapartesVinculadas: 0, documentosInvalidos: 0 };
  let idPorCodigo = new Map<string, string>();
  if (codigosNovos.length > 0) {
    const regsClientes = await buscarTodasPaginas(buscar, cfg, "cadastrosgerais/v10/cliente", { situacao: 1, paginacao: PAGINACAO });
    const clientes = new Map<string, ClienteApi>();
    for (const r of regsClientes) {
      const c = normalizarClienteApi(r);
      if (c) clientes.set(c.codCliente, c);
    }
    idPorCodigo = await resolverContrapartes(banco, codigosNovos, clientes, contagem);
  }
  Object.assign(resumo, contagem);

  // 4) Títulos novos (upsert ignorando duplicata: se rodar duas vezes ao mesmo tempo, não duplica).
  for (const lote of lotes(plano.novos)) {
    const rows = lote.map((t) => ({
      empresa_id: empresa.id,
      contraparte_id: idPorCodigo.get(t.codCliente) as string,
      documento: t.documento,
      parcela: t.parcela,
      emissao: t.emissao,
      vencimento: t.vencimento,
      valor: t.valorCentavos / 100,
      origem: "importacao",
    }));
    const { error } = await banco.from("rec_titulos").upsert(rows, { onConflict: "empresa_id,documento,parcela", ignoreDuplicates: true });
    if (error) throw new Error(`Falha ao gravar títulos novos: ${error.message}`);
  }

  // 5) Títulos alterados (data/valor mudaram no Consistem).
  for (const lote of lotes(plano.alterados, 10)) {
    const resultados = await Promise.all(lote.map((a) => banco.from("rec_titulos").update(a.campos).eq("id", a.id)));
    const falha = resultados.find((r) => r.error);
    if (falha?.error) throw new Error(`Falha ao atualizar títulos: ${falha.error.message}`);
  }

  // 6) Possíveis baixas viram pendência (uma por título, sem repetir).
  const jaPendentes = new Set(
    (await lerTudo<{ referencia_id: string }>((de, ate) =>
      banco.from("pendencias").select("referencia_id").eq("modulo", MODULO).eq("referencia_tabela", "rec_titulos")
        .like("titulo", `${PREFIXO_BAIXA}%`).in("status", ["aberta", "em_andamento"]).order("id").range(de, ate)))
      .map((p) => p.referencia_id),
  );
  const hoje = new Date().toISOString().slice(0, 10);
  const pendenciasNovas = plano.possiveisBaixas.filter((t) => !jaPendentes.has(t.id)).map((t) => ({
    modulo: MODULO,
    empresa_id: empresa.id,
    contraparte_id: contraparteDoTitulo.get(t.id) ?? null,
    titulo: `${PREFIXO_BAIXA}${t.documento}${t.parcela !== "1" ? `/${t.parcela}` : ""}`,
    descricao: "O título saiu da lista de contas a receber em aberto do Consistem. Confirme o pagamento, informe a data e o valor e dê a baixa, ou verifique se foi cancelado ou renegociado.",
    prazo: hoje,
    criticidade: "normal",
    referencia_tabela: "rec_titulos",
    referencia_id: t.id,
    link: "/financeiro/recebiveis",
  }));
  for (const lote of lotes(pendenciasNovas)) {
    const { error } = await banco.from("pendencias").insert(lote);
    if (error) throw new Error(`Falha ao criar pendências de baixa: ${error.message}`);
  }
  resumo.pendenciasCriadas = pendenciasNovas.length;

  // 7) Voltou para a lista em aberto: a pendência de "possível baixa" antiga perde o sentido.
  let canceladas = 0;
  for (const lote of lotes(plano.presentes)) {
    const { data, error } = await banco.from("pendencias").update({ status: "cancelada" })
      .eq("modulo", MODULO).eq("referencia_tabela", "rec_titulos").like("titulo", `${PREFIXO_BAIXA}%`)
      .in("status", ["aberta", "em_andamento"]).in("referencia_id", lote).select("id");
    if (error) throw new Error(`Falha ao encerrar pendências de baixa: ${error.message}`);
    canceladas += data?.length ?? 0;
  }
  resumo.pendenciasCanceladas = canceladas;

  // 8) Registro da execução.
  const { error: erroLog } = await banco.from("importacoes").insert({
    modulo: MODULO,
    tipo: "titulos_abertos",
    arquivo: "api:consistem",
    mapeamento: { origem: "api", empresa: empresa.codigo_erp, recusados: recusados.slice(0, 20), duplicadosApi: plano.duplicadosApi.slice(0, 20) },
    linhas_novas: plano.novos.length,
    linhas_alteradas: plano.alterados.length,
    linhas_baixadas: plano.possiveisBaixas.length, // aqui = "possíveis baixas" (nenhuma é dada automaticamente)
    linhas_divergentes: plano.divergentes.length + recusados.length + plano.duplicadosApi.length,
    usuario_id: usuarioId,
  });
  if (erroLog) throw new Error(`Sincronizou, mas falhou ao registrar a execução: ${erroLog.message}`);
  return resumo;
}

/** Nomes e tipos dos campos que a API devolve (sem valores): para conferir o mapeamento com segurança. */
function descreverCampos(registros: Record<string, unknown>[]): Record<string, string> {
  const campos: Record<string, string> = {};
  for (const r of registros.slice(0, 50)) {
    for (const [k, v] of Object.entries(r)) {
      const tipo = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
      if (!campos[k] || campos[k] === "null") campos[k] = tipo;
    }
  }
  return campos;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  const autorizacao = req.headers.get("Authorization") ?? "";
  if (!autorizacao) return responder({ erro: "Não autenticado." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const chaveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = Deno.env.get("CONSISTEM_API_KEY") ?? "";
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);
  if (token.trim().length < 50) return responder({ erro: "O segredo CONSISTEM_API_KEY não está configurado neste projeto." }, 500);

  // Quem chama: o agendamento (service role) ou um gestor do Financeiro logado.
  const portador = autorizacao.replace(/^Bearer\s+/i, "");
  let usuarioId: string | null = null;
  if (!(await ehServiceRole(url, portador, chaveServico))) {
    const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
    const { data: quem, error: erroUsuario } = await comoUsuario.auth.getUser();
    if (erroUsuario || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
    const { data: permitido, error: erroPermissao } = await comoUsuario.rpc("tem_acesso_modulo", { p_modulo: MODULO, p_minimo: "gestor" });
    if (erroPermissao || permitido !== true) return responder({ erro: "Somente o gestor do Financeiro pode sincronizar com o Consistem." }, 403);
    usuarioId = quem.user.id;
  }

  let corpo: Record<string, unknown>;
  try {
    corpo = await req.json();
  } catch {
    return responder({ erro: "Corpo inválido." }, 400);
  }

  const banco: Banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const cfgBase = { baseUrl: Deno.env.get("CONSISTEM_BASE_URL") || BASE_URL_PADRAO, token };

  const { data: empresas, error: erroEmpresas } = await banco.from("empresas")
    .select("id, nome_curto, codigo_erp").eq("ativa", true).not("codigo_erp", "is", null).order("nome_curto");
  if (erroEmpresas) return responder({ erro: "Não foi possível ler as empresas." }, 500);
  if (!empresas || empresas.length === 0) return responder({ erro: "Nenhuma empresa ativa tem o código do Consistem (empresas.codigo_erp)." }, 400);

  try {
    switch (corpo.acao) {
      case "amostra": {
        const e = empresas[0];
        const cfg: ConfigConsistem = { ...cfgBase, empresa: e.codigo_erp as string };
        const buscar = (u: string, init: { headers: Record<string, string> }) => fetch(u, init);
        const titulos = await buscarTodasPaginas(buscar, cfg, "financeiro/v10/contasReceber", { tipoTitulo: 0, paginacao: 20 });
        return responder({ ok: true, empresa: e.nome_curto, titulos: titulos.length, campos: descreverCampos(titulos) });
      }
      case "sincronizar": {
        const resultados: ResumoEmpresa[] = [];
        for (const e of empresas) {
          resultados.push(await sincronizarEmpresa(banco, e as { id: string; nome_curto: string; codigo_erp: string }, cfgBase, corpo.simular === true, usuarioId));
        }
        return responder({ ok: true, resultados });
      }
      default:
        return responder({ erro: "Ação desconhecida." }, 400);
    }
  } catch (e) {
    if (e instanceof ConsistemErro) return responder({ erro: e.message }, e.status === 401 || e.status === 403 ? 502 : 500);
    return responder({ erro: e instanceof Error ? e.message : "Falha inesperada." }, 500);
  }
});
