"use client";

// Tributo + categoria: a lista de categorias mostra só as do tributo escolhido (e as genéricas). O banco confere de novo.
import { useState } from "react";
import { Campo, SELECT } from "./ui";

type Opcao = { id: string; rotulo: string };
type Cat = { id: string; nome: string; tributo_id: string | null; validada: boolean };

export function SeletorTributoCategoria({ tributos, categorias }: { tributos: Opcao[]; categorias: Cat[] }) {
  const [tributo, setTributo] = useState("");
  const lista = categorias.filter((c) => !c.tributo_id || c.tributo_id === tributo);
  return (
    <>
      <Campo rotulo="Tributo *" htmlFor="nc-trib">
        <select id="nc-trib" name="tributo_id" required className={SELECT} value={tributo} onChange={(e) => setTributo(e.target.value)}>
          <option value="" disabled>Escolha…</option>
          {tributos.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
        </select>
      </Campo>
      <Campo rotulo="Categoria *" htmlFor="nc-cat" dica="A categoria define as formas de utilização e os documentos exigidos (parâmetros do contador).">
        <select id="nc-cat" name="categoria_id" required className={SELECT} defaultValue="" key={tributo} disabled={!tributo}>
          <option value="" disabled>{tributo ? "Escolha…" : "Escolha antes o tributo"}</option>
          {lista.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.tributo_id ? "" : " (genérica)"}{c.validada ? "" : " · parâmetros não validados"}</option>)}
        </select>
      </Campo>
    </>
  );
}
