import { useState } from "react";
import { useApp } from "../estado/store";
import { areaAmbienteM2 } from "../modelo/geometria";
import { PainelReferencia } from "./PainelReferencia";
import { nomeAbertura, nomeParede } from "./nomes";

type Aba = "ambientes" | "estrutura" | "planta";

export function PainelLateral() {
  const [aba, setAba] = useState<Aba>("ambientes");
  return (
    <aside className="painel painel-esq">
      <nav className="abas">
        <button className={aba === "ambientes" ? "ativo" : ""} onClick={() => setAba("ambientes")}>
          Ambientes
        </button>
        <button className={aba === "estrutura" ? "ativo" : ""} onClick={() => setAba("estrutura")}>
          Estrutura
        </button>
        <button className={aba === "planta" ? "ativo" : ""} onClick={() => setAba("planta")} data-teste="aba-planta">
          Planta
        </button>
      </nav>
      <div className="painel-corpo">
        {aba === "ambientes" && <ListaAmbientes />}
        {aba === "estrutura" && <ListaEstrutura />}
        {aba === "planta" && <PainelReferencia />}
      </div>
      <div className="painel-rodape">
        <p className="dica">Móveis e materiais chegam nas próximas etapas.</p>
      </div>
    </aside>
  );
}

function ListaAmbientes() {
  const planta = useApp((s) => s.projeto.planta);
  const selecao = useApp((s) => s.selecao);
  const selecionar = useApp((s) => s.selecionar);
  const definirVisao = useApp((s) => s.definirVisao);
  const total = planta.ambientes.reduce((s, a) => s + areaAmbienteM2(planta, a), 0);
  return (
    <>
      <ul className="lista">
        {planta.ambientes.map((a) => (
          <li key={a.id} className={selecao?.tipo === "ambiente" && selecao.id === a.id ? "selecionado" : ""}>
            <button className="item" onClick={() => selecionar({ tipo: "ambiente", id: a.id })}>
              <span className="amostra" style={{ background: a.piso }} />
              <span className="item-nome">{a.nome}</span>
              <span className="item-valor">≈ {fmtM2(areaAmbienteM2(planta, a))}</span>
            </button>
            {!a.externo || a.tipo === "varanda" ? (
              <button
                className="entrar"
                title="Entrar neste ambiente (vista interna)"
                onClick={() => definirVisao({ camera: "interna", ambienteInterno: a.id })}
              >
                Entrar
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="total">
        Área total (eixo das paredes): <strong>≈ {fmtM2(total)}</strong>
      </p>
    </>
  );
}

function ListaEstrutura() {
  const planta = useApp((s) => s.projeto.planta);
  const selecao = useApp((s) => s.selecao);
  const selecionar = useApp((s) => s.selecionar);
  return (
    <>
      <h3 className="secao">Paredes</h3>
      <ul className="lista compacta">
        {planta.paredes.map((p) => (
          <li key={p.id} className={selecao?.tipo === "parede" && selecao.id === p.id ? "selecionado" : ""}>
            <button className="item" data-teste={`parede-${p.id}`} onClick={() => selecionar({ tipo: "parede", id: p.id })}>
              <span className="item-nome">{nomeParede(planta, p)}</span>
            </button>
          </li>
        ))}
      </ul>
      <h3 className="secao">Portas e janelas</h3>
      <ul className="lista compacta">
        {planta.aberturas.map((ab) => (
          <li key={ab.id} className={selecao?.tipo === "abertura" && selecao.id === ab.id ? "selecionado" : ""}>
            <button className="item" onClick={() => selecionar({ tipo: "abertura", id: ab.id })}>
              <span className="item-nome">{nomeAbertura(planta, ab)}</span>
              <span className="item-valor">{ab.largura.valor}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function fmtM2(n: number) {
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
}
