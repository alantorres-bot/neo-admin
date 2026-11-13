import { useMemo } from "react";
import { itemCatalogo, opcoesDoMovel, slotsDoMovel } from "../catalogo/catalogo";
import { pecasDoMovel } from "../catalogo/formas";
import { useApp } from "../estado/store";
import { ambienteDoPonto } from "../modelo/geometria";
import { conflitosDoMovel, folgaFrontal } from "../modelo/moveis";
import type { Movel, Situacao } from "../modelo/tipos";
import { CampoNumero } from "./campos";
import { NOME_SITUACAO } from "./PainelMoveis";

/** Propriedades do móvel selecionado: medidas em cm, posição, giro, cores e ações. */
export function PropMovel({ movel }: { movel: Movel }) {
  const projeto = useApp((s) => s.projeto);
  const alterarMovel = useApp((s) => s.alterarMovel);
  const duplicar = useApp((s) => s.duplicarMovel);
  const remover = useApp((s) => s.removerMovel);
  const item = itemCatalogo(movel.catalogoId);
  const mudar = (rotulo: string, patch: Partial<Movel>) => alterarMovel(movel.id, rotulo, patch);

  const slots = slotsDoMovel(movel);
  const opcoes = opcoesDoMovel(movel);
  // só as partes que realmente aparecem neste móvel
  const partes = useMemo(() => {
    if (!item) return [];
    const usados = new Set(pecasDoMovel(item.forma, { L: movel.largura, P: movel.profundidade, A: movel.altura }, opcoes).map((p) => p.slot));
    return Object.entries(slots).filter(([nome, s]) => usados.has(nome) && s.acabamento !== "vidro" && s.acabamento !== "espelho" && nome !== "arte" && nome !== "remo");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movel.catalogoId, movel.largura, movel.profundidade, movel.altura, movel.opcoes, movel.cores]);

  const conflitos = conflitosDoMovel(projeto, movel);
  const ambiente = ambienteDoPonto(projeto.planta, movel);
  const folga = movel.elevacao < 100 ? folgaFrontal(projeto, movel) : null;
  const girar = (graus: number) => mudar("Girar móvel", { rotacao: (((movel.rotacao + graus) % 360) + 360) % 360 });

  return (
    <>
      <p className="tipo">{item?.nome ?? "Móvel"}</p>
      <label className="campo">
        <span className="campo-rotulo">Nome</span>
        <input
          id="movel-nome"
          key={movel.id}
          defaultValue={movel.nome}
          onBlur={(e) => e.target.value.trim() && e.target.value !== movel.nome && mudar("Renomear móvel", { nome: e.target.value.trim() })}
        />
      </label>
      <p className="dica">
        {ambiente ? ambiente.nome : "Fora dos ambientes"}
        {folga !== null && folga < 300 ? ` · ${folga} cm livres à frente` : ""}
      </p>

      {conflitos.length > 0 && (
        <div className="aviso" role="status">
          {conflitos.slice(0, 4).map((c, i) => (
            <p key={i}>⚠ {c.mensagem}</p>
          ))}
        </div>
      )}
      {movel.obs && <p className="nota">{movel.obs}</p>}

      <h3 className="secao">Medidas (cm)</h3>
      <div className="linha-tripla">
        <CampoNumero rotulo="Largura" valor={movel.largura} min={1} aoConfirmar={(v) => mudar("Alterar largura", { largura: v })} />
        <CampoNumero rotulo="Profund." valor={movel.profundidade} min={0.5} aoConfirmar={(v) => mudar("Alterar profundidade", { profundidade: v })} />
        <CampoNumero rotulo="Altura" valor={movel.altura} min={0.5} aoConfirmar={(v) => mudar("Alterar altura", { altura: v })} />
      </div>

      <h3 className="secao">Posição</h3>
      <div className="linha-tripla">
        <CampoNumero rotulo="→ x" valor={movel.x} aoConfirmar={(v) => mudar("Mover móvel", { x: v })} />
        <CampoNumero rotulo="↓ y" valor={movel.y} aoConfirmar={(v) => mudar("Mover móvel", { y: v })} />
        <CampoNumero rotulo="Do piso" valor={movel.elevacao} min={0} aoConfirmar={(v) => mudar("Alterar altura do piso", { elevacao: v })} />
      </div>
      <div className="linha-botoes">
        <button className="botao secundario" onClick={() => girar(90)} title="Girar 90° para a esquerda (R)" data-teste="girar-esq">
          ⟲ 90°
        </button>
        <button className="botao secundario" onClick={() => girar(-90)} title="Girar 90° para a direita">
          ⟳ 90°
        </button>
        <CampoNumero rotulo="" unidade="°" valor={movel.rotacao} aoConfirmar={(v) => mudar("Girar móvel", { rotacao: ((v % 360) + 360) % 360 })} />
      </div>
      <p className="dica">Arraste o móvel selecionado para mover: ele encosta sozinho nas paredes e nos outros móveis.</p>

      {(typeof opcoes.portas === "number" || typeof opcoes.gavetas === "number") && (
        <>
          <h3 className="secao">Frentes</h3>
          <div className="linha-tripla">
            <CampoNumero rotulo="Portas" unidade="" valor={Number(opcoes.portas ?? 0)} min={0} aoConfirmar={(v) => mudar("Alterar portas", { opcoes: { ...movel.opcoes, portas: Math.round(v), gavetas: 0 } })} />
            <CampoNumero rotulo="Gavetas" unidade="" valor={Number(opcoes.gavetas ?? 0)} min={0} aoConfirmar={(v) => mudar("Alterar gavetas", { opcoes: { ...movel.opcoes, gavetas: Math.round(v), portas: 0 } })} />
          </div>
        </>
      )}

      {partes.length > 0 && (
        <>
          <h3 className="secao">Cores</h3>
          <div className="cores">
            {partes.map(([nome, s]) => (
              <label key={nome} className="cor">
                <input
                  type="color"
                  id={`cor-${nome}`}
                  value={s.cor.length === 7 ? s.cor : "#cccccc"}
                  onChange={(e) => mudar(`Cor: ${s.rotulo}`, { cores: { ...movel.cores, [nome]: e.target.value } })}
                />
                <span>{s.rotulo}</span>
              </label>
            ))}
          </div>
        </>
      )}

      <label className="campo">
        <span className="campo-rotulo">Situação</span>
        <select id="movel-situacao" value={movel.situacao ?? "sugestao"} onChange={(e) => mudar("Alterar situação", { situacao: e.target.value as Situacao })}>
          {Object.entries(NOME_SITUACAO).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>

      <div className="linha-botoes">
        <button className="botao secundario" onClick={() => duplicar(movel.id)} title="Duplicar (Ctrl+D)" data-teste="duplicar">
          Duplicar
        </button>
        <button className="botao secundario" onClick={() => mudar(movel.travado ? "Destravar móvel" : "Travar móvel", { travado: !movel.travado })} title="Impede mover sem querer">
          {movel.travado ? "Destravar" : "Travar"}
        </button>
        <button className="botao perigo" onClick={() => remover(movel.id)} title="Excluir (Delete)" data-teste="excluir">
          Excluir
        </button>
      </div>
    </>
  );
}
