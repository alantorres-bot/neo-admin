// Edge Function do módulo Financeiro / Comissões (docs/modulos/financeiro-comissoes.md). SÓ LÊ o Consistem.
// Devolve os títulos pagos de um mês com o representante, o cliente e o tipo de baixa de cada um (a lista de pagos não
// traz esses campos: vêm de contasReceber/{codTitulo}) e, para os clientes pedidos (adiantamentos sem título Z), os
// títulos deles com representante e emissão, para sugerir de quem é o adiantamento. A proposta é calculada no app.
//
// Teto por pedido (regra 12): título → NF (nota + cliente, ou a chave) → pedido. Para cada pedido (e para os pedidos dos
// adiantamentos), devolve o valor (total − cancelado) e todos os títulos que ele gerou (NFs do pedido → /titulo), para o
// app somar o que já foi comissionado. NF sem pedido (ou de mais de um pedido): a unidade é a própria NF.
//
// Quem pode chamar: usuário com nível de operador (ou acima) no módulo financeiro.comissoes; ou a service role.
// Corpo: { "mes": "aaaa-mm", "clientes"?: string[] (até 50), "pedidos"?: string[] (até 50) }
//
// Deploy: npx supabase functions deploy fin-comissoes-titulos-pagos --project-ref chdszjpbtfpstjrqnmmm
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  addDias, BASE_URL_PADRAO, buscarJson, buscarObjeto, buscarTodasPaginas, chaveNfe, ConsistemErro, indexarNotas, ligarTituloNota, normalizarNotaSaida,
  normalizarClienteApi, numeroNota, PAGINACAO, type ConfigConsistem, type NotaSaida,
} from "../_shared/consistem-receber.ts";
import { ehNotaSemTitulos, normalizarNotaPedido, normalizarParcela, normalizarPedidoCompleto } from "../_shared/consistem-comercial.ts";

const MODULO = "financeiro.comissoes";
const MAX_TITULOS = 400;
const MAX_CLIENTES = 50;
const MAX_UNIDADES = 80;
const MESES_NF = 36; // janela máxima de emissão das NFs procuradas (título pago hoje de NF antiga)
const CABECALHOS = { "Content-Type": "application/json; charset=utf-8" };
const responder = (corpo: Record<string, unknown>, status = 200) => new Response(JSON.stringify(corpo), { status, headers: CABECALHOS });
const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const centavos = (v: unknown) => (v === null || v === undefined || texto(v) === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
const data = (v: unknown) => {
  const t = texto(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};
/** Lista que a API devolve como array puro ou como { data: [...] }. */
const listaDe = (json: unknown): Record<string, unknown>[] =>
  Array.isArray(json) ? (json as Record<string, unknown>[]) : Array.isArray((json as Record<string, unknown>)?.data) ? ((json as Record<string, unknown>).data as Record<string, unknown>[]) : [];
const codPedido = (v: string) => v.trim().replace(/^0+(?=\d)/, "");

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

  let corpo: { mes?: unknown; clientes?: unknown; pedidos?: unknown };
  try {
    corpo = await req.json();
  } catch {
    return responder({ erro: "Corpo inválido." }, 400);
  }
  const mes = texto(corpo.mes);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return responder({ erro: "Informe o mês como aaaa-mm." }, 400);
  const clientes = Array.isArray(corpo.clientes) ? [...new Set(corpo.clientes.map(texto).filter(Boolean))].slice(0, MAX_CLIENTES) : [];
  const pedidosCreditos = Array.isArray(corpo.pedidos) ? [...new Set(corpo.pedidos.map(texto).filter((x) => /^\d+$/.test(x)).map(codPedido))].slice(0, MAX_CLIENTES) : [];
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
    const detalhes: { p: Record<string, unknown>; d: Record<string, unknown>; cod: string }[] = [];
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
      detalhes.push({ p, d, cod });
    }

    // NF de cada título (nota + cliente, ou a chave): NFs emitidas desde a emissão mais antiga dos títulos com nota.
    const emissoes = detalhes.filter((x) => numeroNota(x.p.notaFiscal ?? x.d.notaFiscal) !== "").map((x) => data(x.d.dataEmissao))
      .filter((x): x is string => !!x).sort();
    const limiteNf = addDias(fim, -MESES_NF * 31);
    const desdeNf = emissoes.length === 0 ? null : emissoes[0] < limiteNf ? limiteNf : emissoes[0];
    let notas: NotaSaida[] = [];
    const tipoDaNota = new Map<string, string>(); // "<nota>\u0000<cliente>" -> codTipoDeNota
    const avisos: string[] = [];
    if (desdeNf) {
      try {
        const brutas = await buscarTodasPaginas(buscar, cfg, "comercial/v10/notaFiscalSaida", {
          situacao: 2, dataEmissaoInicio: desdeNf, dataEmissaoFim: fim, paginacao: PAGINACAO,
        });
        const vistas = new Set<string>();
        for (const r of brutas) {
          const n = normalizarNotaSaida(r);
          if (!n || vistas.has(`${n.nota}\u0000${n.serie}`)) continue;
          vistas.add(`${n.nota}\u0000${n.serie}`);
          notas.push(n);
          if (texto(r.codTipoDeNota)) tipoDaNota.set(`${n.nota}\u0000${n.codCliente}`, texto(r.codTipoDeNota));
        }
      } catch (e) {
        notas = [];
        avisos.push(`NFs não lidas (sem teto por pedido nesta busca): ${e instanceof Error ? e.message : "erro"}`);
      }
    }
    const indice = indexarNotas(notas);

    const titulos: Record<string, unknown>[] = [];
    const unidadesPedidas = new Map<string, { pedido?: string; nota?: NotaSaida }>();
    for (const { p, d, cod } of detalhes) {
      const codCliente = texto(d.codCliente);
      const nota = numeroNota(p.notaFiscal ?? d.notaFiscal);
      let tetoChave: string | null = null, pedido: string | null = null, tipoNota: string | null = null;
      if (nota) {
        const v = ligarTituloNota({ nota, chaveNfe: chaveNfe(d.chaveNfeNotaFiscal), codCliente }, indice);
        if (v.ok) {
          const n = notas[v.indice];
          tipoNota = tipoDaNota.get(`${n.nota}\u0000${n.codCliente}`) ?? null;
          if (n.pedidos.length === 1) {
            pedido = codPedido(n.pedidos[0]);
            tetoChave = `P:${pedido}`;
            unidadesPedidas.set(tetoChave, { pedido });
          } else {
            tetoChave = `N:${n.nota}`;
            unidadesPedidas.set(tetoChave, { nota: n });
          }
        }
      }
      titulos.push({
        cod_titulo: cod, cod_cliente: codCliente || null, cod_representante: texto(d.codRepresentante) || null,
        nota_fiscal: texto(p.notaFiscal ?? d.notaFiscal) || null, valor_centavos: centavos(p.vlrTitulo ?? d.valorTitulo) ?? 0,
        valor_pago_centavos: centavos(p.vlrPago), data_pagamento: data(p.dataPagamento), data_vencimento: data(p.dataVencimento ?? d.dataVenc),
        tipo_baixa: texto(d.tipoBaixa) || null, tipo_nota: tipoNota, comissao_consistem_centavos: centavos(d.valorComissaoLiquidacao) || null,
        cod_pedido: pedido, teto_chave: tetoChave,
      });
    }
    for (const ped of pedidosCreditos) if (!unidadesPedidas.has(`P:${ped}`)) unidadesPedidas.set(`P:${ped}`, { pedido: ped });

    // Valor e títulos de cada unidade do teto.
    const titulosDaNota = async (chave: string): Promise<string[]> => {
      try {
        return listaDe(await buscarJson(buscar, cfg, `comercial/v10/notaFiscalSaida/${encodeURIComponent(chave)}/titulo`))
          .map(normalizarParcela).filter((x): x is NonNullable<typeof x> => x !== null).map((x) => x.cod_titulo);
      } catch (e) {
        if (e instanceof Error && ehNotaSemTitulos(e.message)) return [];
        throw e;
      }
    };
    const unidades: Record<string, { rotulo: string; valor_centavos: number; titulos: string[] }> = {};
    const naoLidas: string[] = [];
    for (const [chave, u] of [...unidadesPedidas].slice(0, MAX_UNIDADES)) {
      try {
        if (u.pedido) {
          const ped = normalizarPedidoCompleto(await buscarObjeto(buscar, cfg, `comercial/v10/pedidoVenda/${encodeURIComponent(u.pedido)}`));
          if (!ped) throw new Error("pedido sem dados");
          let brutas: Record<string, unknown>[] = [];
          try {
            brutas = listaDe(await buscarJson(buscar, cfg, `comercial/v10/notaFiscalSaidaPedido/${encodeURIComponent(u.pedido)}`));
          } catch (e) {
            if (!(e instanceof ConsistemErro && e.status === 400)) throw e; // 400 = pedido sem NF
          }
          const doPedido: string[] = [];
          for (const n of brutas.map(normalizarNotaPedido)) {
            if (n && n.situacao !== "3" && n.chave_acesso) doPedido.push(...(await titulosDaNota(n.chave_acesso)));
          }
          unidades[chave] = {
            rotulo: `pedido ${u.pedido}`, valor_centavos: Math.round((ped.valor_total - ped.valor_cancelado) * 100), titulos: [...new Set(doPedido)],
          };
        } else if (u.nota) {
          unidades[chave] = { rotulo: `NF ${u.nota.nota}`, valor_centavos: u.nota.valorCentavos ?? 0, titulos: u.nota.chave ? await titulosDaNota(u.nota.chave) : [] };
        }
      } catch {
        naoLidas.push(chave.slice(2));
      }
    }
    if (unidadesPedidas.size > MAX_UNIDADES) avisos.push(`Só os ${MAX_UNIDADES} primeiros pedidos/NFs foram lidos para o teto.`);
    if (naoLidas.length > 0) avisos.push(`Sem teto (não lidos no Consistem): ${naoLidas.join(", ")}.`);

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
    // Nome do sacado (vai no relatório do representante): o cadastro do núcleo (contrapartes pelo código do Consistem) e,
    // para quem não está lá, o cadastro de clientes do Consistem.
    const codigosClientes = [...new Set([...titulos.map((t) => texto(t.cod_cliente)), ...clientes].filter(Boolean))];
    const nomes: Record<string, string> = {};
    if (codigosClientes.length > 0) {
      const { data: cps } = await banco.from("contrapartes").select("codigo_erp, nome").in("codigo_erp", codigosClientes);
      for (const c of cps ?? []) if (c.codigo_erp && c.nome) nomes[String(c.codigo_erp)] = String(c.nome);
      if (codigosClientes.some((c) => !nomes[c])) {
        try {
          const regs = await buscarTodasPaginas(buscar, cfg, "cadastrosgerais/v10/cliente", { situacao: 1, paginacao: PAGINACAO });
          for (const r of regs) {
            const c = normalizarClienteApi(r);
            if (c && c.nome && !nomes[c.codCliente] && codigosClientes.includes(c.codCliente)) nomes[c.codCliente] = c.nome;
          }
        } catch {
          avisos.push("Nomes dos clientes não lidos no Consistem (o relatório sai com o código).");
        }
      }
    }
    return responder({ ok: true, periodo: { inicio, fim }, titulos, porCliente, unidades, nomes, falhas, avisos });
  } catch (erro) {
    return responder({ erro: erro instanceof ConsistemErro || erro instanceof Error ? erro.message : "Falha ao consultar o Consistem." }, 502);
  }
});
