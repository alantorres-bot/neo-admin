import { useState } from "react";
import { useApp } from "../estado/store";
import { calibrarEscala, comprimento, conferirCotas } from "../modelo/geometria";
import type { ReferenciaPlanta } from "../modelo/tipos";
import { CampoNumero } from "./campos";

/** Importa a imagem da planta, calibra a escala por uma cota e alinha sob o modelo. */
export function PainelReferencia() {
  const ref = useApp((s) => s.projeto.planta.referencia);
  const provisoria = useApp((s) => s.projeto.planta.provisoria);
  const alterarPlanta = useApp((s) => s.alterarPlanta);
  const calibracao = useApp((s) => s.calibracao);
  const definirCalibracao = useApp((s) => s.definirCalibracao);
  const definirVisao = useApp((s) => s.definirVisao);
  const restaurar = useApp((s) => s.restaurarPlantaOriginal);
  const [cota, setCota] = useState("");

  const alterarRef = (rotulo: string, p: Partial<ReferenciaPlanta>) =>
    alterarPlanta(rotulo, (pl) => (pl.referencia ? { ...pl, referencia: { ...pl.referencia, ...p } } : pl));

  const carregar = async (arquivo: File) => {
    const dataUrl = await new Promise<string>((ok, erro) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = erro;
      r.readAsDataURL(arquivo);
    });
    const img = await new Promise<HTMLImageElement>((ok, erro) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = erro;
      i.src = dataUrl;
    });
    // escala inicial: largura da imagem ≈ 10 m (só para aparecer; calibrar em seguida)
    const cmPorPx = 1000 / img.naturalWidth;
    alterarPlanta("Importar planta de referência", (pl) => ({
      ...pl,
      referencia: {
        imagem: dataUrl,
        larguraPx: img.naturalWidth,
        alturaPx: img.naturalHeight,
        cmPorPx,
        x: -50,
        y: -50,
        rotacao: 0,
        opacidade: 0.6,
        visivel: true,
      },
    }));
    definirVisao({ camera: "superior" });
  };

  const medidoCm = calibracao.pontos.length === 2 ? comprimento(calibracao.pontos[0], calibracao.pontos[1]) : 0;

  const aplicarCalibracao = () => {
    const cotaCm = Number(cota.replace(",", "."));
    if (!ref || !medidoCm || !(cotaCm > 0)) return;
    const medidoPx = medidoCm / ref.cmPorPx;
    alterarRef("Calibrar escala da planta", {
      cmPorPx: calibrarEscala(cotaCm, medidoPx),
      calibracao: { cotaCm, medidoPx },
    });
    definirCalibracao({ ativa: false, pontos: [] });
    setCota("");
  };

  return (
    <div className="ref">
      <ConferenciaCotas />

      {provisoria && (
        <div className="aviso">
          <strong>Planta provisória.</strong> O modelo atual é um layout genérico de 2 quartos com medidas
          estimadas. Ele será substituído pela leitura da planta real do seu apartamento.
        </div>
      )}

      <label className="botao-arquivo">
        {ref ? "Trocar imagem da planta" : "Importar imagem da planta"}
        <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && carregar(e.target.files[0])} />
      </label>
      <p className="dica">PNG ou JPG. Para PDF, exporte a página como imagem.</p>

      {ref && (
        <>
          <h3 className="secao">1. Escala</h3>
          <p className="dica">
            {ref.calibracao
              ? `Calibrada: cota de ${ref.calibracao.cotaCm} cm = ${ref.calibracao.medidoPx.toFixed(0)} px (${ref.cmPorPx.toFixed(3)} cm/px).`
              : "Ainda não calibrada. Escolha a maior cota legível da planta."}
          </p>
          {!calibracao.ativa ? (
            <button
              className="botao"
              onClick={() => {
                definirVisao({ camera: "superior" });
                definirCalibracao({ ativa: true, pontos: [] });
              }}
            >
              Calibrar pela cota
            </button>
          ) : (
            <div className="calibracao">
              <p>
                Clique nas <strong>duas pontas</strong> de uma cota na imagem ({calibracao.pontos.length}/2).
              </p>
              {calibracao.pontos.length === 2 && (
                <label className="campo">
                  <span className="campo-rotulo">Valor da cota</span>
                  <span className="campo-entrada">
                    <input autoFocus value={cota} onChange={(e) => setCota(e.target.value)} onKeyDown={(e) => e.key === "Enter" && aplicarCalibracao()} />
                    <span className="unidade">cm</span>
                  </span>
                </label>
              )}
              <div className="linha-botoes">
                <button className="botao" disabled={calibracao.pontos.length < 2 || !cota} onClick={aplicarCalibracao}>
                  Aplicar
                </button>
                <button className="botao secundario" onClick={() => definirCalibracao({ ativa: false, pontos: [] })}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <h3 className="secao">2. Alinhamento</h3>
          <CampoNumero rotulo="Mover → (x)" valor={ref.x} aoConfirmar={(x) => alterarRef("Mover planta", { x })} />
          <CampoNumero rotulo="Mover ↓ (y)" valor={ref.y} aoConfirmar={(y) => alterarRef("Mover planta", { y })} />
          <CampoNumero rotulo="Girar" unidade="°" valor={ref.rotacao} aoConfirmar={(rotacao) => alterarRef("Girar planta", { rotacao })} />
          <label className="campo">
            <span className="campo-rotulo">Transparência</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={ref.opacidade}
              onChange={(e) => useApp.setState((s) => ({ projeto: { ...s.projeto, planta: { ...s.projeto.planta, referencia: { ...ref, opacidade: Number(e.target.value) } } } }))}
            />
          </label>
          <label className="campo checagem">
            <input type="checkbox" checked={ref.visivel} onChange={(e) => alterarRef("Mostrar/ocultar planta", { visivel: e.target.checked })} />
            <span>Mostrar a planta sob o modelo</span>
          </label>
          <button className="botao secundario" onClick={() => alterarPlanta("Remover planta de referência", (pl) => ({ ...pl, referencia: undefined }))}>
            Remover imagem
          </button>
        </>
      )}

      <h3 className="secao">Modelo</h3>
      <button className="botao secundario" onClick={restaurar}>
        Restaurar planta original
      </button>
      <p className="dica">Desfaz todas as correções de medida e volta à leitura original da planta.</p>
    </div>
  );
}

function ConferenciaCotas() {
  const planta = useApp((s) => s.projeto.planta);
  const lista = conferirCotas(planta);
  if (lista.length === 0) return null;
  const ok = lista.filter((c) => c.confere && c.cota.situacao === "confirmada").length;
  return (
    <>
      <h3 className="secao">Cotas da planta</h3>
      <p className="dica">
        {ok} de {lista.length} conferem com o modelo (tolerância 1 cm). Medidas lidas como vão interno.
      </p>
      <ul className="lista compacta cotas" data-teste="lista-cotas">
        {lista.map(({ cota, modelo, diferenca, confere }) => (
          <li key={cota.id} title={cota.obs ?? ""}>
            <span className={`marca-cota ${cota.situacao === "a-confirmar" ? "duvida" : confere ? "ok" : "erro"}`}>
              {cota.situacao === "a-confirmar" ? "?" : confere ? "✓" : "!"}
            </span>
            <span className="item-nome">{cota.descricao}</span>
            <span className="item-valor">
              {cota.texto}
              {!confere && Number.isFinite(modelo) ? ` → ${(modelo / 100).toFixed(2).replace(".", ",")} (${diferenca > 0 ? "+" : ""}${diferenca.toFixed(0)})` : ""}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
