"use client";

// Listas do Consistem (migration 0143): categorias de fornecedor e contas do fluxo de caixa (grupo › conta), no lugar dos
// números digitados. Usadas no cadastro do fornecedor, no lançamento da compra, no estabelecimento e nos códigos do cartão.
import { useState } from "react";

import type { CategoriaFornecedor, ContaFluxo } from "@/lib/modulos/financeiro/cartao/listas";

const SELECAO = "h-8 w-full rounded-[3px] border border-input bg-white px-2 text-[13px]";
const chave = (grupo?: number | null, item?: number | null) => (grupo && item ? `${grupo}/${item}` : "");

/** Lista grupo › conta (só as ativas, mais a atual se estiver inativa). */
export function SeletorContaFluxo({ contas, grupo, item, aoMudar, id }: {
  contas: readonly ContaFluxo[]; grupo?: number | null; item?: number | null; aoMudar: (grupo: number | null, item: number | null) => void; id?: string;
}) {
  const atual = chave(grupo, item);
  const grupos = new Map<number, { descricao: string; contas: ContaFluxo[] }>();
  for (const c of contas) {
    if (!c.ativa && chave(c.grupo, c.item) !== atual) continue;
    const g = grupos.get(c.grupo) ?? { descricao: c.grupo_descricao, contas: [] };
    g.contas.push(c);
    grupos.set(c.grupo, g);
  }
  const conhecida = contas.some((c) => chave(c.grupo, c.item) === atual);
  return (
    <select id={id} className={SELECAO} value={atual} onChange={(e) => {
      const [g, i] = e.target.value.split("/").map(Number);
      aoMudar(g || null, i || null);
    }}>
      <option value="">— escolher —</option>
      {atual && !conhecida && <option value={atual}>{atual} (fora da lista)</option>}
      {[...grupos.entries()].map(([g, x]) => (
        <optgroup key={g} label={`${g} · ${x.descricao}`}>
          {x.contas.map((c) => <option key={c.item} value={chave(c.grupo, c.item)}>{c.grupo}/{c.item} · {c.descricao}{c.ativa ? "" : " (inativa)"}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** Para formulários (FormData): a lista mais dois campos ocultos `<prefixo>grupoContaFluxoCaixa` e `<prefixo>contaFluxoCaixa`. */
export function CampoContaFluxo({ contas, prefixo, grupo, conta }: { contas: readonly ContaFluxo[]; prefixo: string; grupo?: number | null; conta?: number | null }) {
  const [valor, setValor] = useState<{ g: number | null; i: number | null }>({ g: grupo ?? null, i: conta ?? null });
  return (
    <label className="block space-y-1 text-sm sm:col-span-2">
      <span className="block font-medium">Conta de fluxo de caixa</span>
      <SeletorContaFluxo contas={contas} grupo={valor.g} item={valor.i} aoMudar={(g, i) => setValor({ g, i })} />
      <input type="hidden" name={`${prefixo}grupoContaFluxoCaixa`} value={valor.g ?? ""} />
      <input type="hidden" name={`${prefixo}contaFluxoCaixa`} value={valor.i ?? ""} />
    </label>
  );
}

export function SeletorCategoria({ categorias, valor, aoMudar }: { categorias: readonly CategoriaFornecedor[]; valor: number | null; aoMudar: (v: number | null) => void }) {
  return (
    <select className={SELECAO} value={valor ?? ""} onChange={(e) => aoMudar(e.target.value ? Number(e.target.value) : null)}>
      <option value="">— escolher —</option>
      {categorias.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.descricao}</option>)}
    </select>
  );
}
