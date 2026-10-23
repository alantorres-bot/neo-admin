// Edge Function do módulo Financeiro > Intimações de cartório: fala com o Consistem. Especificação:
// docs/modulos/financeiro-intimacoes-cartorio.md; migration 0181.
//
// Ações (corpo JSON):
//   { "acao": "consultar", "id": "<intimação>" }  — operador ou acima. SÓ LEITURA: acha o credor pelo CNPJ
//       (cap_fornecedores_por_documento) e lista os títulos dele (GET contasPagar, filtro por fornecedor e janela de vencimento),
//       com a sugestão de casarTitulos. Nada é gravado.
//   { "acao": "alterar_vencimento", "id": "<alteração>" }  — gestor, o MESMO que aprovou (fin_int_aprovar_vencimento reservou):
//       lê o título, altera SÓ a data de vencimento, lê de novo e confere (alterarVencimentoNoConsistem). Uma tentativa; erro
//       ou dúvida = revisão. Nunca repete sozinho.
// NÃO existe ação de adiantamento: ele é lançado à mão na tela do Consistem (a inclusão pela API não fica igual; seção 9).
// Segredos: CONSISTEM_API_KEY (token do CSMEN050) e CONSISTEM_BASE_URL (opcional).
//
// Deploy: npx supabase functions deploy fin-intimacoes-consistem --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import { BASE_URL_PADRAO, buscarObjeto, buscarTodasPaginas, limparToken, PAGINACAO, type ConfigConsistem } from "../_shared/consistem-receber.ts";
import { alterarTitulo, complementoCabeNaAlteracao, conferirAlteracao, jaAlterado, ROTA_INCLUSAO_LANCAMENTO } from "../_shared/consistem-inclusao.ts";
import { normalizarLancamentoPagar, ROTA_CONTAS_PAGAR } from "../_shared/consistem-pagar.ts";
import { alterarVencimentoNoConsistem, casarTitulos, janelaVencimento, type PortaConsistem, type TituloPagar } from "../_shared/intimacoes.ts";

/** A mesma ligação das correções do Cartão (crt-corrigir-no-consistem): GET e PUT em lancamentoContasPagar/{id}, nada mais. */
const portaConsistem = (cfg: ConfigConsistem): PortaConsistem => ({
  lerDetalhe: (cod) => buscarObjeto((u, init) => fetch(u, init), cfg, `${ROTA_INCLUSAO_LANCAMENTO}/${encodeURIComponent(cod)}`),
  alterar: (cod, corpo) => alterarTitulo((u, init) => fetch(u, init), cfg, cod, corpo, "o vencimento é conferido pelo detalhe do título"),
  jaAlterado,
  complementoLongo: complementoCabeNaAlteracao,
  conferir: conferirAlteracao,
});

const responder = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hojeCuiaba = () => new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);
  const autorizacao = req.headers.get("Authorization") ?? "";
  if (!autorizacao) return responder({ erro: "Não autenticado." }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const chaveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  const chaveServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !chaveAnonima || !chaveServico) return responder({ erro: "Função mal configurada." }, 500);

  const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
  const { data: quem, error: erroUsuario } = await comoUsuario.auth.getUser();
  if (erroUsuario || !quem.user) return responder({ erro: "Sessão inválida." }, 401);

  let corpo: { acao?: string; id?: string } = {};
  try { corpo = await req.json(); } catch { /* vazio */ }
  const id = corpo.id && UUID.test(corpo.id) ? corpo.id : null;
  if (!id) return responder({ erro: "Pedido inválido." }, 400);
  const token = limparToken(Deno.env.get("CONSISTEM_API_KEY") ?? "");
  if (!token) return responder({ erro: "O segredo CONSISTEM_API_KEY não está configurado neste projeto." }, 500);
  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const buscar = (u: string, init: { headers: Record<string, string> }) => fetch(u, init);
  const configDaEmpresa = async (empresaId: string) => {
    const { data } = await banco.from("empresas").select("codigo_erp").eq("id", empresaId).maybeSingle();
    return data?.codigo_erp ? { baseUrl: Deno.env.get("CONSISTEM_BASE_URL") || BASE_URL_PADRAO, token, empresa: String(data.codigo_erp) } : null;
  };

  if (corpo.acao === "consultar") {
    const { data: permitido } = await comoUsuario.rpc("tem_acesso_area", { p_area: "financeiro", p_minimo: "operador" });
    if (permitido !== true) return responder({ erro: "Somente operador do Financeiro (ou acima) consulta títulos no Consistem." }, 403);
    const { data: i } = await banco.from("fin_intimacoes").select("empresa_id, credor_documento, credor_nome, numero_titulo, valor_titulo, vencimento_titulo").eq("id", id).maybeSingle();
    if (!i) return responder({ erro: "Intimação não encontrada." }, 404);
    if (!i.empresa_id || !i.credor_documento) return responder({ erro: "Informe a empresa e o CNPJ do credor antes de consultar." }, 400);
    const cfg = await configDaEmpresa(i.empresa_id);
    if (!cfg) return responder({ erro: "A empresa não tem o código do Consistem (empresas.codigo_erp)." }, 400);
    // CNPJ mascarado (portal do 4º Ofício): a função confere os dígitos visíveis e o nome.
    const { data: fornecedores, error } = await banco.rpc("cap_fornecedores_por_documento", { p_empresa: i.empresa_id, p_documento: i.credor_documento, p_nome: i.credor_nome });
    if (error) return responder({ erro: `Não foi possível procurar o fornecedor: ${error.message}` }, 500);
    if (!fornecedores?.length) {
      return responder({ ok: true, fornecedores: [], candidatos: [], sugerido: null,
        aviso: `Nenhum fornecedor com o CNPJ ${i.credor_documento}${i.credor_documento?.includes("*") ? ` e o nome ${i.credor_nome ?? "?"}` : ""} no espelho do Contas a Pagar. Confira o cadastro ou informe o CNPJ completo.` });
    }
    const janela = i.vencimento_titulo ? janelaVencimento(i.vencimento_titulo) : janelaVencimento(hojeCuiaba(), 400);
    try {
      const lista: TituloPagar[] = [];
      for (const f of fornecedores as { cod_fornecedor: string }[]) {
        const brutos = await buscarTodasPaginas(buscar, cfg, ROTA_CONTAS_PAGAR, {
          campoFiltroDinamico: "codFornecedor", valorFiltroDinamico: f.cod_fornecedor,
          dataVencimentoIni: janela.ini, dataVencimentoFim: janela.fim, paginacao: PAGINACAO,
        });
        for (const r of brutos) {
          const n = normalizarLancamentoPagar(r);
          if (n.ok) lista.push(n.lancamento);
        }
      }
      const r = casarTitulos({ numeroTitulo: i.numero_titulo, valorTitulo: i.valor_titulo === null ? null : Number(i.valor_titulo) }, lista);
      return responder({ ok: true, fornecedores, janela, lidos: lista.length, ...r });
    } catch (e) {
      return responder({ erro: `Não foi possível consultar o Consistem: ${(e as Error).message}` }, 502);
    }
  }

  if (corpo.acao === "alterar_vencimento") {
    const { data: v } = await banco.from("fin_intimacao_vencimentos").select("id, empresa_id, cod_lancamento, alteracao, situacao, aprovado_por").eq("id", id).maybeSingle();
    if (!v || v.situacao !== "reservado") return responder({ erro: "Nada a enviar: esta alteração já foi feita ou não existe." }, 409);
    if (v.aprovado_por !== quem.user.id) return responder({ erro: "Só o gestor que aprovou envia a alteração." }, 403);
    const concluir = (ok: boolean, jaEstava: boolean, antes: unknown, depois: unknown, resposta: unknown, erro: string | null) =>
      banco.rpc("fin_int_concluir_vencimento", { p_id: id, p_ok: ok, p_ja_estava: jaEstava, p_antes: antes, p_depois: depois, p_resposta: resposta, p_erro: erro });
    const cfg = await configDaEmpresa(v.empresa_id);
    if (!cfg) {
      const mensagem = "A empresa não tem o código do Consistem (empresas.codigo_erp). Nada foi alterado.";
      await concluir(false, false, null, null, null, mensagem);
      return responder({ erro: mensagem }, 400);
    }
    const { error: erroInicio } = await banco.rpc("fin_int_iniciar_vencimento", { p_id: id });
    if (erroInicio) return responder({ erro: erroInicio.message }, 409);
    const novaData = String((v.alteracao as { dataVencimento?: string }).dataVencimento ?? "");
    const r = await alterarVencimentoNoConsistem(portaConsistem(cfg), v.cod_lancamento, novaData);
    if (!r.ok) {
      await concluir(false, false, r.antes, r.depois, r.resposta ?? null, r.mensagem);
      return responder({ erro: r.mensagem }, 422);
    }
    const { error } = await concluir(true, r.jaEstava, r.antes, r.depois, r.resposta ?? null, null);
    if (error) return responder({ erro: `O vencimento foi alterado e conferido no Consistem, mas não foi possível registrar: ${error.message}` }, 500);
    return responder({ ok: true, aviso: r.jaEstava ? `O título ${v.cod_lancamento} já estava com esse vencimento: registrado.` : `Vencimento do título ${v.cod_lancamento} alterado e conferido no Consistem.` });
  }

  return responder({ erro: "Ação desconhecida." }, 400);
});
