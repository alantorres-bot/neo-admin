import { useMemo, useState } from "react";
import { CATALOGO, NOME_CATEGORIA, type Categoria } from "../catalogo/catalogo";
import { useApp } from "../estado/store";
import { ambienteDoPonto } from "../modelo/geometria";
import { conflitosDoProjeto } from "../modelo/moveis";
import type { Movel, Situacao } from "../modelo/tipos";

export const NOME_SITUACAO: Record<Situacao, string> = {
  tenho: "Já tenho",
  comprar: "Comprar",
  "sob-medida": "Sob medida",
  sugestao: "Sugestão",
};

type Filtro = "todos" | Situacao;

/** Aba Móveis: o que está no apartamento (por ambiente) e a biblioteca para adicionar. */
export function PainelMoveis() {
  const [modo, setModo] = useState<"projeto" | "adicionar">("projeto");
  return (
    <>
      <div className="segmento" role="tablist" aria-label="Móveis">
        <button role="tab" aria-selected={modo === "projeto"} className={modo === "projeto" ? "ativo" : ""} onClick={() => setModo("projeto")}>
          No apartamento
        </button>
        <button role="tab" aria-selected={modo === "adicionar"} className={modo === "adicionar" ? "ativo" : ""} onClick={() => setModo("adicionar")} data-teste="moveis-adicionar">
          Adicionar
        </button>
      </div>
      {modo === "projeto" ? <NoApartamento /> : <Biblioteca aoAdicionar={() => setModo("projeto")} />}
    </>
  );
}

function NoApartamento() {
  const projeto = useApp((s) => s.projeto);
  const selecao = useApp((s) => s.selecao);
  const selecionar = useApp((s) => s.selecionar);
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const conflitos = useMemo(() => conflitosDoProjeto(projeto), [projeto]);
  const grupos = useMemo(() => {
    const porAmbiente = new Map<string, Movel[]>();
    for (const m of projeto.moveis) {
      if (filtro !== "todos" && m.situacao !== filtro) continue;
      const amb = ambienteDoPonto(projeto.planta, m);
      const chave = amb?.nome ?? "Fora dos ambientes";
      porAmbiente.set(chave, [...(porAmbiente.get(chave) ?? []), m]);
    }
    return [...porAmbiente.entries()];
  }, [projeto, filtro]);

  const contagem = (s: Situacao) => projeto.moveis.filter((m) => m.situacao === s).length;

  return (
    <>
      <div className="chips" role="group" aria-label="Filtrar por situação">
        {(["todos", "tenho", "comprar", "sob-medida", "sugestao"] as Filtro[]).map((f) => (
          <button key={f} className={filtro === f ? "ativo" : ""} onClick={() => setFiltro(f)}>
            {f === "todos" ? `Todos ${projeto.moveis.length}` : `${NOME_SITUACAO[f]} ${contagem(f)}`}
          </button>
        ))}
      </div>
      {conflitos.size > 0 && <p className="aviso">⚠ {conflitos.size} {conflitos.size === 1 ? "item com conflito" : "itens com conflito"} de posição.</p>}
      {grupos.map(([nome, itens]) => (
        <section key={nome}>
          <h3 className="secao">
            {nome} <span className="conta">{itens.length}</span>
          </h3>
          <ul className="lista compacta">
            {itens.map((m) => (
              <li key={m.id} className={selecao?.tipo === "movel" && selecao.id === m.id ? "selecionado" : ""}>
                <button className="item" onClick={() => selecionar({ tipo: "movel", id: m.id })} data-teste={`movel-${m.id}`}>
                  <span className={`ponto ponto-${m.situacao ?? "sugestao"}`} title={NOME_SITUACAO[m.situacao ?? "sugestao"]} />
                  <span className="item-nome">{m.nome}</span>
                  {conflitos.has(m.id) && <span className="alerta-item" title="Conflito de posição">⚠</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {grupos.length === 0 && <p className="dica">Nenhum item nesta situação.</p>}
    </>
  );
}

function Biblioteca({ aoAdicionar }: { aoAdicionar: () => void }) {
  const [categoria, setCategoria] = useState<Categoria>("sala");
  const adicionar = useApp((s) => s.adicionarMovel);
  const destino = useApp((s) => {
    const id = s.selecao?.tipo === "ambiente" ? s.selecao.id : s.visao.ambienteInterno;
    return s.projeto.planta.ambientes.find((a) => a.id === id)?.nome;
  });
  const itens = CATALOGO.filter((i) => i.categoria === categoria);
  return (
    <>
      <div className="chips" role="group" aria-label="Categoria">
        {(Object.keys(NOME_CATEGORIA) as Categoria[]).map((c) => (
          <button key={c} className={categoria === c ? "ativo" : ""} onClick={() => setCategoria(c)}>
            {NOME_CATEGORIA[c]}
          </button>
        ))}
      </div>
      <p className="dica">
        Toque num item para colocá-lo {destino ? `em ${destino}` : "no apartamento"}. Depois arraste para o lugar. Para escolher outro ambiente, selecione o piso dele antes.
      </p>
      <ul className="lista compacta biblioteca">
        {itens.map((i) => (
          <li key={i.id}>
            <button
              className="item"
              data-teste={`catalogo-${i.id}`}
              onClick={() => {
                adicionar(i.id);
                aoAdicionar();
              }}
            >
              <span className="amostra" style={{ background: Object.values(i.slots)[0]?.cor }} />
              <span className="item-nome">{i.nome}</span>
              <span className="item-valor">
                {fmt(i.largura)} × {fmt(i.profundidade)} × {fmt(i.altura)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

const fmt = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");
