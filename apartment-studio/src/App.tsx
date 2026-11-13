import { useEffect } from "react";
import { useApp } from "./estado/store";
import { Cena } from "./cena/Cena";
import { CamadaRotulos } from "./cena/Rotulos";
import { BarraFerramentas } from "./ui/BarraFerramentas";
import { PainelLateral } from "./ui/PainelLateral";
import { PainelPropriedades } from "./ui/PainelPropriedades";

export function App() {
  const carregado = useApp((s) => s.carregado);
  const camera = useApp((s) => s.visao.camera);
  const provisoria = useApp((s) => s.projeto.planta.provisoria);
  const calibrando = useApp((s) => s.calibracao.ativa);

  useEffect(() => {
    useApp.getState().inicializar();
  }, []);

  return (
    <div className="app">
      <BarraFerramentas />
      <main className="palco">
        {carregado ? <Cena /> : <div className="carregando">Abrindo o projeto…</div>}
        {carregado && <CamadaRotulos />}
        <PainelLateral />
        <PainelPropriedades />
        <div className="faixa-inferior">
          {calibrando && <span className="pilula destaque">Calibrando: clique nas duas pontas de uma cota na imagem</span>}
          {camera === "interna" && <span className="pilula">Arraste para olhar · W A S D ou setas para andar</span>}
          {camera === "perspectiva" && <span className="pilula">Arraste para girar · botão direito para mover · role para aproximar</span>}
          {camera === "superior" && <span className="pilula">Arraste para mover · role para aproximar · 1 quadrado = 1 m</span>}
          {provisoria && <span className="pilula alerta">Planta provisória · medidas estimadas (≈)</span>}
        </div>
      </main>
    </div>
  );
}
