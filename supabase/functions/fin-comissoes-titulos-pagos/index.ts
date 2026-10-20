// Edge Function do módulo Financeiro / Comissões (docs/modulos/financeiro-comissoes.md). SÓ LÊ o Consistem.
// Devolve os títulos pagos de um mês com o representante, o cliente e o tipo de baixa de cada um (a lista de pagos não
// traz esses campos: vêm de contasReceber/{codTitulo}) e, para os clientes pedidos (adiantamentos sem título Z), os
// títulos deles com representante e emissão, para sugerir de quem é o adiantamento. A proposta é calculada no app.
//
// Quem pode chamar: usuário com nível de operador (ou acima) no módulo financeiro.comissoes; ou a service role.
// Corpo: { "mes": "aaaa-mm", "clientes"?: string[] (até 50) }
//
// Deploy: npx supabase functions deploy fin-comissoes-titulos-pagos --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import { BASE_URL_PADRAO, buscarObjeto, buscarTodasPaginas, ConsistemErro, PAGINACAO, type ConfigConsistem } from "../_shared/consistem-receber.ts";

const MODULO = "financeiro.comissoes";
const MAX_TITULOS = 400;
const MAX_CLIENTES = 50;
const CABECALHOS = { "Content-Type": "application/json; charset=utf-8" };
const responder = (corpo: Record<string, unknown>, status = 200) => new Response(JSON.stringify(corpo), { status, headers: CABECALHOS });
const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const centavos = (v: unknown) => (v === null || v === undefined || texto(v) === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
const data = (v: unknown) => {
  const t = texto(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};

function iguaisSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

  if (!iguaisSeguro(autorizacao.replace(/^Bearer\s+/i, ""), chaveServico)) {
    const comoUsuario = createClient(url, chaveAnonima, { global: { headers: { Authorization: autorizacao } } });
    const { data: quem, error: erroUsuario } = await comoUsuario.auth.getUser();
    if (erroUsuario || !quem.user) return responder({ erro: "Sessão inválida." }, 401);
    const { data: permitido, error: erroPermissao } = await comoUsuario.rpc("tem_acesso_modulo", { p_modulo: MODULO, p_minimo: "operador" });
    if (erroPermissao || permitido !== true) return responder({ erro: "Somente operador do Financeiro (ou acima) monta o fechamento de comissões." }, 403);
  }
  if (token.trim().length < 50) return responder({ erro: "O segredo CONSISTEM_API_KEY não está configurado neste projeto." }, 500);

  let corpo: { mes?: unknown; clientes?: unknown };
  try {
    corpo = await req.json();
  } catch {
    return responder({ erro: "Corpo inválido." }, 400);
  }
  const mes = texto(corpo.mes);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return responder({ erro: "Informe o mês como aaaa-mm." }, 400);
  const clientes = Array.isArray(corpo.clientes) ? [...new Set(corpo.clientes.map(texto).filter(Boolean))].slice(0, MAX_CLIENTES) : [];
  const [ano, m] = mes.split("-").map(Number);
  const inicio = `${mes}-01`;
  const fim = new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10);

  const banco = createClient(url, chaveServico, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: empresas } = await banco.from("empresas").select("codigo_erp").eq("ativa", true).not("codigo_erp", "is", null).order("nome_curto").limit(1);
  if (!empresas?.length) return responder({ erro: "Nenhuma empresa ativa tem o código do Consistem (empresas.codigo_erp)." }, 400);
  const cfg: ConfigConsistem = { baseUrl: Deno.env.get("CONSISTEM_BASE_URL") || BASE_URL_PADRAO, token, empresa: empresas[0].codigo_erp as string };
  const buscar = (u: string, init: { headers: Record<string, string> }) => fetch(u, init);

  try {
    const pagos = await buscarTodasPaginas(buscar, cfg, "financeiro/v10/titulosPagos", { dataInicio: inicio, dataFim: fim }, { campoLista: "titulosPagos" });
    if (pagos.length > MAX_TITULOS) return responder({ erro: `O mês tem ${pagos.length} títulos pagos, acima do limite de ${MAX_TITULOS}.` }, 400);

    // Representante, cliente e tipo de baixa de cada título pago.
    const titulos: Record<string, unknown>[] = [];
    const falhas: string[] = [];
    const vistos = new Set<string>();
    for (const p of pagos) {
      const cod = texto(p.codTitulo);
      if (!cod || vistos.has(cod)) continue;
      vistos.add(cod);
      let d: Record<string, unknown> = {};
      try {
        d = await buscarObjeto(buscar, cfg, `financeiro/v10/contasReceber/${encodeURIComponent(cod)}`);
      } catch {
        falhas.push(cod);
      }
      titulos.push({
        cod_titulo: cod, cod_cliente: texto(d.codCliente) || null, cod_representante: texto(d.codRepresentante) || null,
        nota_fiscal: texto(p.notaFiscal ?? d.notaFiscal) || null, valor_centavos: centavos(p.vlrTitulo ?? d.valorTitulo) ?? 0,
        valor_pago_centavos: centavos(p.vlrPago), data_pagamento: data(p.dataPagamento), data_vencimento: data(p.dataVencimento ?? d.dataVenc),
        tipo_baixa: texto(d.tipoBaixa) || null, tipo_nota: null, comissao_consistem_centavos: centavos(d.valorComissaoLiquidacao) || null,
      });
    }

    // Títulos dos clientes de adiantamento (para sugerir o representante).
    const porCliente: Record<string, { cod_representante: string | null; data_emissao: string | null }[]> = {};
    for (const c of clientes) {
      try {
        const lista = await buscarTodasPaginas(buscar, cfg, "financeiro/v10/contasReceber", { tipoTitulo: 3, listaCliente: c, paginacao: PAGINACAO });
        porCliente[c] = lista.map((t) => ({ cod_representante: texto(t.codRepresentante) || null, data_emissao: data(t.dataEmissao) }));
      } catch {
        porCliente[c] = [];
      }
    }
    return responder({ ok: true, periodo: { inicio, fim }, titulos, porCliente, falhas });
  } catch (erro) {
    return responder({ erro: erro instanceof ConsistemErro || erro instanceof Error ? erro.message : "Falha ao consultar o Consistem." }, 502);
  }
});
