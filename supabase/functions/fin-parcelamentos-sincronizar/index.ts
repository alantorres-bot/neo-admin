// Edge Function do módulo Financeiro > Gestão de Parcelamentos: lê o Contas a Pagar do Consistem. SÓ LEITURA (GET).
// Especificação: docs/modulos/financeiro-parcelamentos.md; migration 0189.
//
// { "acao": "sincronizar", "empresaId"?: "<uuid>" } — operador do módulo, service role ou o agendamento (x-sincronizacao-segredo).
// Por empresa com código do ERP:
//   1. GET financeiro/v10/contasPagar com campoFiltroDinamico=tipoLancamento / valorFiltroDinamico=P (≈1.200 registros, toda a vida)
//      e com campoFiltroDinamico=codFornecedor para cada fornecedor das regras ativas (≈500 cada) → par_registrar_lista
//      (idempotente; só P e C; devolve os que deviam ter vindo e não vieram).
//   2. GET financeiro/v10/lancamentoContasPagar/{id} dos que precisam (par_para_detalhar: saíram da lista, nunca detalhados,
//      C de parcelamento ainda não quitado), até LIMITE_DETALHES por rodada → par_registrar_detalhes.
//      HTTP 400 "Lançamento não cadastrado!" (ou 404) = excluído no ERP (sumiu_em; nunca apaga).
//   3. GET cadastrosgerais/v10/fornecedor/{id} dos códigos ainda sem nome → par_registrar_fornecedores.
// Cada rodada fica em par_sincronizacoes (resumo ou erro). Nada é escrito no Consistem.
// Segredos: CONSISTEM_API_KEY (token do CSMEN050), CONSISTEM_BASE_URL (opcional), SINCRONIZACAO_SEGREDO (agendamento).
//
// Publicação: só por `node scripts/publicar.mjs` (docs/PUBLICACAO.md, seção 4.1).
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { BASE_URL_PADRAO, buscarObjeto, buscarTodasPaginas, ConsistemErro, limparToken, PAGINACAO, type ConfigConsistem } from "../_shared/consistem-receber.ts";
import { juntarListasParcelamento, lancamentoNaoCadastrado, normalizarDetalheParcelamento, normalizarFornecedorApi, ROTA_CONTAS_PAGAR, ROTA_DETALHE_LANCAMENTO, ROTA_FORNECEDORES, type DetalheParcelamento } from "../_shared/consistem-pagar.ts";

const MODULO = "financeiro.parcelamentos";
const LIMITE_DETALHES = 400;
const PARALELO = 5;
const PRAZO_MS = 110_000; // a função tem ~150 s; o que sobrar fica para a próxima rodada

const responder = (corpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

function iguaisSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** O chamador é a service role? (mesma regra de cap-sincronizar-consistem) */
async function ehServiceRole(url: string, portador: string, chaveServico: string): Promise<boolean> {
  if (portador === "") return false;
  if (iguaisSeguro(portador, chaveServico)) return true;
  const pareceChaveDeServico = portador.startsWith("sb_secret_") || (() => {
    try {
      return JSON.parse(atob(portador.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role === "service_role";
    } catch {
      return false;
    }
  })();
  if (!pareceChaveDeServico) return false;
  const tentativa = createClient(url, portador, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await tentativa.auth.admin.listUsers({ page: 1, perPage: 1 });
  return !error;
}

// deno-lint-ignore no-explicit-any
type Banco = SupabaseClient<any, "public", any>;
type Empresa = { id: string; nome_curto: string; codigo_erp: string };
const buscar = (u: string, init: { headers: Record<string, string> }) => fetch(u, init);

async function rpc<T>(banco: Banco, funcao: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await banco.rpc(funcao, args);
  if (error) throw new Error(`${funcao}: ${error.message}`);
  return data as T;
}

async function emLotes<T, R>(itens: readonly T[], fn: (x: T) => Promise<R>, ate: number): Promise<R[]> {
  const saida: R[] = [];
  for (let i = 0; i < itens.length && Date.now() < ate; i += PARALELO) saida.push(...(await Promise.all(itens.slice(i, i + PARALELO).map(fn))));
  return saida;
}

async function sincronizarEmpresa(banco: Banco, empresa: Empresa, cfg: ConfigConsistem, ate: number): Promise<Record<string, unknown>> {
  // 1) Listas: todos os P (filtro tipoLancamento) e TODOS os lançamentos dos fornecedores das regras ativas (filtro codFornecedor;
  //    os dois filtros funcionam no servidor, verificado em 11/11/2026). A segunda traz o saldo dos C (baixa) e o C lançado com
  //    código novo quando o P é excluído no Consistem (caso real: 336 9982-08/26 e 09/26).
  const { data: regras, error: erroRegras } = await banco.from("par_regras").select("fornecedores, empresa_id").eq("ativa", true).not("fornecedores", "is", null);
  if (erroRegras) throw new Error(`Regras: ${erroRegras.message}`);
  const fornecedores = [...new Set((regras ?? []).filter((r) => !r.empresa_id || r.empresa_id === empresa.id).flatMap((r) => r.fornecedores as string[]))]
    .filter((f) => /^\d{1,10}$/.test(f)).sort();
  const listas = [await buscarTodasPaginas(buscar, cfg, ROTA_CONTAS_PAGAR, { campoFiltroDinamico: "tipoLancamento", valorFiltroDinamico: "P", paginacao: PAGINACAO })];
  for (const f of fornecedores) listas.push(await buscarTodasPaginas(buscar, cfg, ROTA_CONTAS_PAGAR, { campoFiltroDinamico: "codFornecedor", valorFiltroDinamico: f, paginacao: PAGINACAO }));
  const { lancamentos, recusados } = juntarListasParcelamento(listas);
  const lista = await rpc<{ novos: number; alterados: number; iguais: number; quitados: number; foraDaLista: string[] }>(banco, "par_registrar_lista",
    { p_empresa: empresa.id, p_lancamentos: lancamentos, p_fornecedores: fornecedores });

  // 2) Detalhes
  const codigos = await rpc<string[]>(banco, "par_para_detalhar", { p_empresa: empresa.id, p_fora: lista.foraDaLista, p_limite: LIMITE_DETALHES });
  const falhas: string[] = [];
  const detalhes = (await emLotes(codigos, async (cod): Promise<DetalheParcelamento | null> => {
    try {
      return normalizarDetalheParcelamento(cod, await buscarObjeto(buscar, cfg, `${ROTA_DETALHE_LANCAMENTO}/${encodeURIComponent(cod)}`));
    } catch (e) {
      if (e instanceof ConsistemErro && lancamentoNaoCadastrado(e.status, e.message)) return { codLancamento: cod, encontrado: false };
      falhas.push(`${cod}: ${(e as Error).message.slice(0, 120)}`);
      return null; // tenta de novo na próxima rodada
    }
  }, ate)).filter((d): d is DetalheParcelamento => d !== null);
  const det = detalhes.length ? await rpc<Record<string, number>>(banco, "par_registrar_detalhes", { p_empresa: empresa.id, p_detalhes: detalhes }) : {};

  // 3) Nomes dos fornecedores
  const semNome = await rpc<string[]>(banco, "par_fornecedores_sem_nome", { p_empresa: empresa.id });
  const nomes: Record<string, string> = {};
  await emLotes(semNome, async (cod) => {
    try {
      const f = normalizarFornecedorApi(await buscarObjeto(buscar, cfg, `${ROTA_FORNECEDORES}/${encodeURIComponent(cod)}`));
      if (f && f.codFornecedor === cod) nomes[cod] = f.nome;
    } catch { /* nome é só informação: tenta na próxima */ }
  }, ate);
  if (Object.keys(nomes).length) await rpc(banco, "par_registrar_fornecedores", { p_empresa: empresa.id, p_nomes: nomes });

  return {
    empresa: empresa.nome_curto, registrosNaApi: listas.reduce((s, l) => s + l.length, 0), fornecedoresListados: fornecedores,
    projecoes: lancamentos.filter((l) => l.tipo === "P").length, titulosC: lancamentos.filter((l) => l.tipo === "C").length, recusados: recusados.slice(0, 20),
    ...lista, foraDaLista: lista.foraDaLista.length, detalhesPedidos: codigos.length, detalhes: det, falhasDetalhe: falhas.slice(0, 20),
    detalhesAdiados: codigos.length - detalhes.length - falhas.length, fornecedoresNomeados: Object.keys(nomes).length,
  };
}

Deno.serve(async (req) => {
  const inicio = Date.now();
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  const autorizacao = req.headers.get("Authorization") ?? "";
  const segredoRecebido = req.headers.get("x-sincronizacao-segredo") ?? "";
  if (!autorizacao && !segredoRecebido) return responder({ erro: "Não autenticado." }, 401);
  let corpo: { acao?: string; empresaId?: string } = {};
  try { corpo = await req.json(); } catch { return responder({ erro: "Corpo inválido." }, 400); }
  if (corpo.acao !== "sincronizar") return responder({ erro: "Ação inválida." }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const chaveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);

  // Quem chama: o agendamento (segredo do Vault), a service role, ou um operador do módulo logado. verify_jwt = false (config.toml).
  let usuarioId: string | null = null;
  let agendado = false;
  if (segredoRecebido) {
    const esperado = Deno.env.get("SINCRONIZACAO_SEGREDO") ?? "";
    if (esperado.length < 32 || !iguaisSeguro(segredoRecebido, esperado)) return responder({ erro: "Não autorizado." }, 401);
    agendado = true;
  } else if (!(await ehServiceRole(url, autorizacao.replace(/^Bearer\s+/i, ""), chaveServico))) {
    const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
    const { data: quem, error } = await comoUsuario.auth.getUser();
    if (error || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
    const { data: permitido } = await comoUsuario.rpc("tem_acesso_modulo", { p_modulo: MODULO, p_minimo: "operador" });
    if (permitido !== true) return responder({ erro: "Somente operador do Financeiro (ou acima) atualiza os parcelamentos." }, 403);
    usuarioId = quem.user.id;
  }

  const token = limparToken(Deno.env.get("CONSISTEM_API_KEY") ?? "");
  if (!token) return responder({ erro: "O segredo CONSISTEM_API_KEY não está configurado neste projeto." }, 500);
  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });

  let consulta = banco.from("empresas").select("id, nome_curto, codigo_erp").eq("ativa", true).not("codigo_erp", "is", null).order("nome_curto");
  if (corpo.empresaId) consulta = consulta.eq("id", corpo.empresaId);
  const { data: empresas, error: erroEmpresas } = await consulta;
  if (erroEmpresas) return responder({ erro: "Não foi possível ler as empresas." }, 500);
  if (!empresas?.length) return responder({ erro: "Nenhuma empresa ativa tem o código do Consistem (empresas.codigo_erp)." }, 400);

  const resumos: Record<string, unknown>[] = [];
  let algumErro = false;
  for (const e of empresas as Empresa[]) {
    let rodada: string;
    try {
      rodada = await rpc<string>(banco, "par_iniciar_sincronizacao", { p_empresa: e.id, p_agendada: agendado, p_usuario: usuarioId });
    } catch (erro) { // ex.: já há leitura em andamento para a empresa
      algumErro = true;
      resumos.push({ empresa: e.nome_curto, erro: (erro as Error).message.replace(/^par_iniciar_sincronizacao: /, "").slice(0, 300) });
      continue;
    }
    const cfg: ConfigConsistem = { baseUrl: Deno.env.get("CONSISTEM_BASE_URL") || BASE_URL_PADRAO, token, empresa: e.codigo_erp };
    try {
      const resumo = await sincronizarEmpresa(banco, e, cfg, inicio + PRAZO_MS);
      await rpc(banco, "par_concluir_sincronizacao", { p_id: rodada, p_erro: null, p_resumo: resumo });
      resumos.push(resumo);
    } catch (erro) {
      algumErro = true;
      const mensagem = (erro as Error).message.slice(0, 500);
      await rpc(banco, "par_concluir_sincronizacao", { p_id: rodada, p_erro: mensagem, p_resumo: null }).catch(() => {});
      resumos.push({ empresa: e.nome_curto, erro: mensagem });
    }
  }
  return responder({ ok: !algumErro, segundos: Math.round((Date.now() - inicio) / 1000), empresas: resumos }, algumErro ? 502 : 200);
});
