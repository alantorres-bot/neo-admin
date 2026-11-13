import { useEffect, useState } from "react";
import type { Medida, OrigemMedida } from "../modelo/tipos";

const ROTULO_ORIGEM: Record<OrigemMedida, { texto: string; dica: string }> = {
  cota: { texto: "cota", dica: "Medida lida na planta" },
  derivada: { texto: "derivada", dica: "Calculada a partir de cotas da planta" },
  estimada: { texto: "≈ estimada", dica: "Estimativa — confira e corrija com a medida real" },
  manual: { texto: "corrigida", dica: "Medida informada por você" },
};

export function SeloOrigem({ origem }: { origem: OrigemMedida }) {
  const r = ROTULO_ORIGEM[origem];
  return (
    <span className={`selo selo-${origem}`} title={r.dica}>
      {r.texto}
    </span>
  );
}

/** Campo numérico que só confirma ao sair do campo ou apertar Enter (evita histórico a cada tecla). */
export function CampoNumero({
  rotulo,
  valor,
  aoConfirmar,
  unidade = "cm",
  min,
  passo = 1,
  extra,
}: {
  rotulo: string;
  valor: number;
  aoConfirmar: (v: number) => void;
  unidade?: string;
  min?: number;
  passo?: number;
  extra?: React.ReactNode;
}) {
  const [texto, setTexto] = useState(fmt(valor));
  useEffect(() => setTexto(fmt(valor)), [valor]);

  const confirmar = () => {
    const n = Number(texto.replace(",", "."));
    if (!Number.isFinite(n) || (min !== undefined && n < min)) {
      setTexto(fmt(valor));
      return;
    }
    if (n !== valor) aoConfirmar(n);
  };

  return (
    <label className="campo">
      <span className="campo-rotulo">{rotulo}</span>
      <span className="campo-entrada">
        <input
          inputMode="decimal"
          value={texto}
          step={passo}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={confirmar}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setTexto(fmt(valor));
          }}
        />
        <span className="unidade">{unidade}</span>
      </span>
      {extra}
    </label>
  );
}

export function CampoMedida({
  rotulo,
  medida,
  aoAlterar,
  min = 0,
}: {
  rotulo: string;
  medida: Medida;
  aoAlterar: (m: Medida) => void;
  min?: number;
}) {
  return (
    <CampoNumero
      rotulo={rotulo}
      valor={medida.valor}
      min={min}
      aoConfirmar={(v) => aoAlterar({ valor: v, origem: "manual" })}
      extra={<SeloOrigem origem={medida.origem} />}
    />
  );
}

function fmt(n: number) {
  return String(Math.round(n * 10) / 10).replace(".", ",");
}
