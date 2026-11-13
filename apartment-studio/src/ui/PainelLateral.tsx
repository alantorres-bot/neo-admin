import { useApp, type AbaPainel } from "../estado/store";
import { areaAmbienteM2 } from "../modelo/geometria";
import { PainelMoveis } from "./PainelMoveis";
import { vistaDoAmbiente } from "./PainelPropriedades";
import { PainelReferencia } from "./PainelReferencia";
import { nomeAbertura, nomeParede } from "./nomes";

const ABAS: { id: AbaPainel; rotulo: string }[] = [
  { id: "ambientes", rotulo: "Ambientes" },
  { id: "moveis", rotulo: "Móveis" },
  { id: "estrutura", rotulo: "Estrutura" },
  { id: "planta", rotulo: "Planta" },
];

export function PainelLateral() {
  const { aba, aberto } = useApp((s) => s.painel);
  const definirPainel = useApp((s) => s.definirPainel);
  return (
    <aside className={`painel painel-esq ${aberto ? "" : "fechado"}`} aria-label="Projeto">
      <nav className="abas" role="tablist">
        {ABAS.map((a) => (
          <button
            key={a.id}
            role="tab"
            aria-selected={aba === a.id}
            className={aba === a.id ? "ativo" : ""}
            data-teste={`aba-${a.id}`}
            // no celular, tocar na aba aberta recolhe o painel para ver o apartamento inteiro
            onClick={() => definirPainel({ aba: a.id, aberto: aba === a.id ? !aberto : true })}
          >
            {a.rotulo}
          </button>
        ))}
      </nav>
      <div className="painel-corpo">
        {aba === "ambientes" && <ListaAmbientes />}
        {aba === "moveis" && <PainelMoveis />}
        {aba === "estrutura" && <ListaEstrutura />}
        {aba === "planta" && <PainelReferencia />}
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
            <button
              className="entrar"
              title="Entrar neste ambiente (vista interna)"
              data-teste={`entrar-${a.id}`}
              onClick={() => definirVisao({ camera: "interna", ambienteInterno: a.id, vistaId: vistaDoAmbiente(a.id) })}
            >
              Entrar
            </button>
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
