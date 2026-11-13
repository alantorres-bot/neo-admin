import { useEffect } from "react";
import { useApp, type ModoCamera, type ModoParedes } from "../estado/store";

const CAMERAS: { id: ModoCamera; rotulo: string; dica: string }[] = [
  { id: "perspectiva", rotulo: "3D", dica: "Vista em perspectiva — arraste para girar, role ou pince para aproximar" },
  { id: "superior", rotulo: "Planta", dica: "Vista de cima, como a planta baixa" },
  { id: "interna", rotulo: "Por dentro", dica: "Altura dos olhos — arraste para olhar; W A S D, setas ou os botões para andar" },
];

const PAREDES: { id: ModoParedes; rotulo: string }[] = [
  { id: "inteiras", rotulo: "Inteiras" },
  { id: "recortadas", rotulo: "Baixas" },
  { id: "ocultas", rotulo: "Ocultas" },
];

export function BarraFerramentas() {
  const visao = useApp((s) => s.visao);
  const definirVisao = useApp((s) => s.definirVisao);
  const desfazer = useApp((s) => s.desfazer);
  const refazer = useApp((s) => s.refazer);
  const podeDesfazer = useApp((s) => s.passado.length > 0);
  const podeRefazer = useApp((s) => s.futuro.length > 0);
  const ultimo = useApp((s) => s.passado.at(-1)?.rotulo);
  const salvoEm = useApp((s) => s.salvoEm);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      const s = useApp.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const tecla = e.key.toLowerCase();
      if (ctrl && tecla === "z") {
        e.preventDefault();
        if (e.shiftKey) s.refazer();
        else s.desfazer();
        return;
      }
      if (ctrl && tecla === "y") {
        e.preventDefault();
        s.refazer();
        return;
      }
      if (e.key === "Escape") {
        s.selecionar(null);
        return;
      }
      // atalhos do móvel selecionado
      const movel = s.selecao?.tipo === "movel" ? s.projeto.moveis.find((m) => m.id === s.selecao!.id) : undefined;
      if (!movel) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        s.removerMovel(movel.id);
      } else if (ctrl && tecla === "d") {
        e.preventDefault();
        s.duplicarMovel(movel.id);
      } else if (tecla === "r" && !ctrl) {
        s.alterarMovel(movel.id, "Girar móvel", { rotacao: (movel.rotacao + 90) % 360 });
      } else if (e.key.startsWith("Arrow") && s.visao.camera !== "interna" && !movel.travado) {
        e.preventDefault();
        const passo = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -passo : e.key === "ArrowRight" ? passo : 0;
        const dy = e.key === "ArrowUp" ? -passo : e.key === "ArrowDown" ? passo : 0;
        s.alterarMovel(movel.id, "Mover móvel", { x: movel.x + dx, y: movel.y + dy });
      }
    };
    window.addEventListener("keydown", kd);
    return () => window.removeEventListener("keydown", kd);
  }, []);

  const alternar = (chave: "teto" | "cotas" | "moveis" | "luzArtificial") => definirVisao({ [chave]: !visao[chave] });

  return (
    <header className="barra">
      <div className="marca">
        <span className="marca-icone" aria-hidden="true">
          ◰
        </span>
        <span className="marca-nome">Apartment Studio</span>
      </div>

      <div className="grupo" role="group" aria-label="Câmera">
        {CAMERAS.map((c) => (
          <button key={c.id} className={visao.camera === c.id ? "ativo" : ""} title={c.dica} onClick={() => definirVisao({ camera: c.id })} data-teste={`camera-${c.id}`}>
            {c.rotulo}
          </button>
        ))}
      </div>

      <div className="grupo" role="group" aria-label="Paredes" title="Como mostrar as paredes nas vistas de fora">
        <span className="grupo-rotulo">Paredes</span>
        {PAREDES.map((p) => (
          <button key={p.id} className={visao.paredes === p.id ? "ativo" : ""} disabled={visao.camera === "interna"} onClick={() => definirVisao({ paredes: p.id })} data-teste={`paredes-${p.id}`}>
            {p.rotulo}
          </button>
        ))}
      </div>

      <div className="grupo" role="group" aria-label="Mostrar">
        <button className={visao.moveis ? "ativo" : ""} onClick={() => alternar("moveis")} title="Mostrar ou ocultar os móveis" data-teste="alternar-moveis">
          Móveis
        </button>
        <button className={visao.teto ? "ativo" : ""} onClick={() => alternar("teto")} title="Mostrar ou ocultar o teto">
          Teto
        </button>
        <button className={visao.cotas ? "ativo" : ""} onClick={() => alternar("cotas")} title="Nomes, áreas e medidas">
          Medidas
        </button>
        <button className={visao.luzArtificial ? "ativo" : ""} onClick={() => alternar("luzArtificial")} title="Acender as luzes dos ambientes" data-teste="alternar-luzes">
          Luzes
        </button>
        <label className="hora" title="Hora do dia (posição do sol)">
          ☀ {String(Math.floor(visao.horaSol)).padStart(2, "0")}h
          <input id="hora-sol" type="range" min={6} max={18} step={0.5} value={visao.horaSol} onChange={(e) => definirVisao({ horaSol: Number(e.target.value) })} aria-label="Hora do dia" />
        </label>
      </div>

      <div className="grupo direita">
        <button onClick={desfazer} disabled={!podeDesfazer} title={ultimo ? `Desfazer: ${ultimo} (Ctrl+Z)` : "Desfazer (Ctrl+Z)"} aria-label="Desfazer" data-teste="desfazer">
          ↶
        </button>
        <button onClick={refazer} disabled={!podeRefazer} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer" data-teste="refazer">
          ↷
        </button>
        <span className="salvo" title="O projeto fica salvo neste navegador">
          {salvoEm ? `Salvo ${new Date(salvoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Salva sozinho"}
        </span>
      </div>
    </header>
  );
}
