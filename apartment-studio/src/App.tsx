import { useEffect } from "react";
import { useApp } from "./estado/store";
import { Cena } from "./cena/Cena";
import { CamadaRotulos } from "./cena/Rotulos";
import { BarraFerramentas } from "./ui/BarraFerramentas";
import { PainelLateral } from "./ui/PainelLateral";
import { PainelPropriedades } from "./ui/PainelPropriedades";
import { BarraVistas, ControleAndar } from "./ui/Vistas";

export function App() {
  const carregado = useApp((s) => s.carregado);
  const camera = useApp((s) => s.visao.camera);
  const provisoria = useApp((s) => s.projeto.planta.provisoria);
  const calibrando = useApp((s) => s.calibracao.ativa);
  const novaBase = useApp((s) => s.novaBase);
  const temSelecao = useApp((s) => s.selecao !== null);

  useEffect(() => {
    useApp.getState().inicializar();
  }, []);

  return (
    <div className="app">
      <BarraFerramentas />
      <main className={`palco ${temSelecao ? "com-selecao" : ""}`}>
        {carregado ? <Cena /> : <div className="carregando">Abrindo o projeto…</div>}
        {carregado && <CamadaRotulos />}
        <BarraVistas />
        <PainelLateral />
        <PainelPropriedades />
        <ControleAndar />
        <div className="faixa-inferior">
          {calibrando && <span className="pilula destaque">Calibrando: clique nas duas pontas de uma cota na imagem</span>}
          {camera === "interna" && <span className="pilula">Arraste para olhar · botões ou W A S D para andar</span>}
          {camera === "perspectiva" && <span className="pilula">Arraste para girar · toque num móvel para selecionar e arraste para mover</span>}
          {camera === "superior" && <span className="pilula">Arraste para mover a planta · 1 quadrado = 1 m</span>}
          {provisoria && <span className="pilula alerta">Planta provisória · medidas estimadas (≈)</span>}
        </div>
        {novaBase && <AvisoBase />}
      </main>
    </div>
  );
}

/** Quando o Claude publica uma versão nova do projeto e este navegador tem alterações próprias. */
function AvisoBase() {
  const adotar = useApp((s) => s.adotarBase);
  return (
    <div className="aviso-base" role="alertdialog" aria-label="Nova versão do projeto">
      <p>
        <strong>Há uma versão nova do projeto.</strong> Você fez alterações neste aparelho. Carregar a versão nova substitui as suas (uma cópia fica guardada).
      </p>
      <div className="linha-botoes">
        <button className="botao" onClick={() => adotar()}>
          Carregar a versão nova
        </button>
        <button className="botao secundario" onClick={() => useApp.setState({ novaBase: false })}>
          Manter a minha
        </button>
      </div>
    </div>
  );
}
