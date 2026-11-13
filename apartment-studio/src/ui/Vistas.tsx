import { invalidate } from "@react-three/fiber";
import { andar } from "../cena/andar";
import { useApp } from "../estado/store";

/** Botões de perspectiva por ambiente (como fotos do apartamento): Entrada, Sala, Cozinha, Suíte… */
export function BarraVistas() {
  const vistas = useApp((s) => s.projeto.vistas);
  const camera = useApp((s) => s.visao.camera);
  const vistaId = useApp((s) => s.visao.vistaId);
  const definirVisao = useApp((s) => s.definirVisao);
  if (vistas.length === 0) return null;
  return (
    <nav className="vistas" aria-label="Vistas internas">
      {vistas.map((v) => (
        <button
          key={v.id}
          className={camera === "interna" && vistaId === v.id ? "ativo" : ""}
          data-teste={`vista-${v.id}`}
          onClick={() => definirVisao({ camera: "interna", vistaId: v.id, ambienteInterno: v.ambienteId ?? "amb-sala" })}
        >
          {v.nome}
        </button>
      ))}
    </nav>
  );
}

/** Botões de andar na vista interna (para toque; no teclado valem W A S D e as setas). */
export function ControleAndar() {
  const interna = useApp((s) => s.visao.camera === "interna");
  if (!interna) return null;
  const botao = (rotulo: string, nome: string, eixo: "frente" | "lado", valor: number, area: string) => {
    const soltar = () => {
      andar[eixo] = 0;
    };
    return (
      <button
        aria-label={nome}
        style={{ gridArea: area }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          andar[eixo] = valor;
          invalidate();
        }}
        onPointerUp={soltar}
        onPointerCancel={soltar}
        onLostPointerCapture={soltar}
        onContextMenu={(e) => e.preventDefault()}
      >
        {rotulo}
      </button>
    );
  };
  return (
    <div className="andar" role="group" aria-label="Andar">
      {botao("▲", "Andar para a frente", "frente", 1, "c")}
      {botao("◀", "Andar para a esquerda", "lado", -1, "e")}
      {botao("▼", "Andar para trás", "frente", -1, "b")}
      {botao("▶", "Andar para a direita", "lado", 1, "d")}
    </div>
  );
}
