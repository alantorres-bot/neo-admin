import { useEffect } from "react";
import { useApp, type ModoCamera, type ModoParedes } from "../estado/store";

const CAMERAS: { id: ModoCamera; rotulo: string; dica: string }[] = [
  { id: "perspectiva", rotulo: "3D", dica: "Vista em perspectiva — arraste para girar, role para aproximar" },
  { id: "superior", rotulo: "Planta", dica: "Vista de cima, como a planta baixa" },
  { id: "interna", rotulo: "Andar por dentro", dica: "Altura dos olhos — arraste para olhar, W A S D ou setas para andar" },
];

const PAREDES: { id: ModoParedes; rotulo: string }[] = [
  { id: "inteiras", rotulo: "Inteiras" },
  { id: "recortadas", rotulo: "Recortadas" },
  { id: "ocultas", rotulo: "Ocultas" },
];

export function BarraFerramentas() {
  const visao = useApp((s) => s.visao);
  const definirVisao = useApp((s) => s.definirVisao);
  const desfazer = useApp((s) => s.desfazer);
  const refazer = useApp((s) => s.refazer);
  const podeDesfazer = useApp((s) => s.passado.length > 0);
  const podeRefazer = useApp((s) => s.futuro.length > 0);
  const salvoEm = useApp((s) => s.salvoEm);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) refazer();
        else desfazer();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        refazer();
      }
    };
    window.addEventListener("keydown", kd);
    return () => window.removeEventListener("keydown", kd);
  }, [desfazer, refazer]);

  return (
    <header className="barra">
      <div className="marca">
        <span className="marca-icone" aria-hidden>
          ◰
        </span>
        <span>Apartment Studio</span>
      </div>

      <div className="grupo" role="group" aria-label="Câmera">
        {CAMERAS.map((c) => (
          <button
            key={c.id}
            className={visao.camera === c.id ? "ativo" : ""}
            title={c.dica}
            onClick={() => definirVisao({ camera: c.id })}
            data-teste={`camera-${c.id}`}
          >
            {c.rotulo}
          </button>
        ))}
      </div>

      <div className="grupo" role="group" aria-label="Paredes" title="Como mostrar as paredes nas vistas de fora">
        <span className="grupo-rotulo">Paredes</span>
        {PAREDES.map((p) => (
          <button
            key={p.id}
            className={visao.paredes === p.id ? "ativo" : ""}
            disabled={visao.camera === "interna"}
            onClick={() => definirVisao({ paredes: p.id })}
            data-teste={`paredes-${p.id}`}
          >
            {p.rotulo}
          </button>
        ))}
      </div>

      <div className="grupo">
        <button className={visao.teto ? "ativo" : ""} onClick={() => definirVisao({ teto: !visao.teto })} title="Mostrar ou ocultar o teto">
          Teto
        </button>
        <button className={visao.cotas ? "ativo" : ""} onClick={() => definirVisao({ cotas: !visao.cotas })} title="Nomes, áreas e medidas">
          Medidas
        </button>
        <button
          className={visao.luzArtificial ? "ativo" : ""}
          onClick={() => definirVisao({ luzArtificial: !visao.luzArtificial })}
          title="Acender as luzes dos ambientes"
        >
          Luzes
        </button>
        <label className="hora" title="Hora do dia (posição do sol)">
          ☀ {String(Math.floor(visao.horaSol)).padStart(2, "0")}h
          <input
            type="range"
            min={6}
            max={18}
            step={0.5}
            value={visao.horaSol}
            onChange={(e) => definirVisao({ horaSol: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="grupo direita">
        <button onClick={desfazer} disabled={!podeDesfazer} title="Desfazer (Ctrl+Z)">
          ↶
        </button>
        <button onClick={refazer} disabled={!podeRefazer} title="Refazer (Ctrl+Shift+Z)">
          ↷
        </button>
        <span className="salvo" title="O projeto fica salvo neste navegador">
          {salvoEm ? `Salvo ${new Date(salvoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Salvamento automático"}
        </span>
      </div>
    </header>
  );
}
