import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { gerarImagem, limiteDeImagem, NOME_FORMATO, nomeDoArquivo, QUALIDADES, qualidadesDisponiveis, tamanhoDaImagem, type FormatoImagem } from "../cena/exportar";
import { emPaginaPublicada, salvarArquivo } from "../estado/arquivos";
import { useApp } from "../estado/store";
import { LIMITE_VERSOES, mesmaDecoracao, nomePadrao, TAMANHO_NOME, type Versao } from "../modelo/versoes";
import { capturarMiniatura } from "./miniatura";

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", " às");

/** Aba Versões: guardar e comparar decorações, exportar a imagem da vista e voltar no histórico. */
export function PainelVersoes() {
  return (
    <>
      <Versoes />
      <ExportarImagem />
      <Historico />
    </>
  );
}

function Versoes() {
  const versoes = useApp((s) => s.versoes);
  const projeto = useApp((s) => s.projeto);
  const salvarVersao = useApp((s) => s.salvarVersao);
  const [nome, setNome] = useState("");
  const cheio = versoes.length >= LIMITE_VERSOES;
  // qual versão é igual ao que está aberto agora (comparação cara: só refaz quando algo muda)
  const aberta = useMemo(() => versoes.find((v) => mesmaDecoracao(v, projeto))?.id, [versoes, projeto]);

  const salvar = () => {
    if (salvarVersao(nome, capturarMiniatura())) setNome("");
  };

  return (
    <>
      <h3 className="secao">Versões da decoração</h3>
      <p className="dica">Guarde a decoração como está agora, com um nome. Depois dá para comparar opções e voltar a qualquer uma.</p>
      <form
        className="nova-versao"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <input id="versao-nome" value={nome} maxLength={TAMANHO_NOME} placeholder={nomePadrao(versoes, new Date())} aria-label="Nome da versão" onChange={(e) => setNome(e.target.value)} />
        <button className="botao" type="submit" disabled={cheio} data-teste="versao-salvar">
          Salvar versão
        </button>
      </form>
      {cheio && <div className="aviso">Limite de {LIMITE_VERSOES} versões atingido: exclua alguma para guardar outra.</div>}
      <ul className="versoes">
        {versoes.map((v) => (
          <CartaoVersao key={v.id} versao={v} aberta={v.id === aberta} cheio={cheio} />
        ))}
      </ul>
      {versoes.length === 0 && <p className="dica">Nenhuma versão guardada ainda.</p>}
    </>
  );
}

function CartaoVersao({ versao, aberta, cheio }: { versao: Versao; aberta: boolean; cheio: boolean }) {
  const abrir = useApp((s) => s.abrirVersao);
  const duplicar = useApp((s) => s.duplicarVersao);
  const renomear = useApp((s) => s.renomearVersao);
  const excluir = useApp((s) => s.excluirVersao);
  const [modo, setModo] = useState<"normal" | "renomeando" | "excluindo">("normal");
  const [nome, setNome] = useState(versao.nome);

  const confirmarNome = () => {
    renomear(versao.id, nome);
    setModo("normal");
  };

  return (
    <li className={`versao${aberta ? " aberta" : ""}`} data-teste={`versao-${versao.id}`}>
      {versao.miniatura ? <img className="versao-miniatura" src={versao.miniatura} alt="" /> : <span className="versao-miniatura vazia" aria-hidden="true" />}
      <div className="versao-corpo">
        {modo === "renomeando" ? (
          <form
            className="nova-versao"
            onSubmit={(e) => {
              e.preventDefault();
              confirmarNome();
            }}
          >
            <input autoFocus value={nome} maxLength={TAMANHO_NOME} aria-label="Novo nome da versão" onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setModo("normal")} />
            <button className="botao" type="submit">
              OK
            </button>
          </form>
        ) : (
          <p className="versao-nome">{versao.nome}</p>
        )}
        <p className="versao-data">
          {quando(versao.criadaEm)}
          {aberta && <span className="selo selo-cota">é a que está aberta</span>}
        </p>
        {modo === "excluindo" ? (
          <div className="versao-acoes" role="group" aria-label="Confirmar exclusão">
            <span className="versao-pergunta">Excluir esta versão?</span>
            <button className="ligacao perigo" onClick={() => excluir(versao.id)} data-teste="versao-excluir-sim">
              Sim, excluir
            </button>
            <button className="ligacao" onClick={() => setModo("normal")}>
              Não
            </button>
          </div>
        ) : (
          <div className="versao-acoes">
            <button className="ligacao" onClick={() => abrir(versao.id)} disabled={aberta} data-teste="versao-abrir">
              Abrir
            </button>
            <button className="ligacao" onClick={() => duplicar(versao.id)} disabled={cheio} data-teste="versao-duplicar">
              Duplicar
            </button>
            <button
              className="ligacao"
              onClick={() => {
                setNome(versao.nome);
                setModo("renomeando");
              }}
              data-teste="versao-renomear"
            >
              Renomear
            </button>
            <button className="ligacao perigo" onClick={() => setModo("excluindo")} data-teste="versao-excluir">
              Excluir
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

const paraDataUrl = (blob: Blob) =>
  new Promise<string>((ok, falha) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(String(leitor.result));
    leitor.onerror = () => falha(new Error("Não foi possível ler a imagem gerada."));
    leitor.readAsDataURL(blob);
  });

type Etapa = { tipo: "parado" } | { tipo: "gerando" } | { tipo: "erro"; mensagem: string } | { tipo: "pronta"; url: string; blob: Blob; nome: string; largura: number; altura: number; aviso?: string };

function ExportarImagem() {
  const [formato, setFormato] = useState<FormatoImagem>("tela");
  const [qualidade, setQualidade] = useState<(typeof QUALIDADES)[number]["id"]>("alta");
  const [etapa, setEtapa] = useState<Etapa>({ tipo: "parado" });
  // em celular e tablet a memória de vídeo é curta: a qualidade máxima (4K) fica só para computador
  const toque = typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth < 760);
  const qualidades = qualidadesDisponiveis(toque);

  // Esc fecha a prévia
  const aberta = etapa.tipo === "pronta";
  useEffect(() => {
    if (!aberta) return;
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setEtapa({ tipo: "parado" });
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aberta]);

  const gerar = async () => {
    const app = useApp.getState();
    app.selecionar(null); // sem o contorno de seleção na imagem
    setEtapa({ tipo: "gerando" });
    try {
      const cena = document.querySelector<HTMLCanvasElement>(".palco canvas");
      const tela = { largura: cena?.clientWidth || window.innerWidth, altura: cena?.clientHeight || window.innerHeight };
      const lado = (qualidades.find((q) => q.id === qualidade) ?? qualidades[0] ?? QUALIDADES[0]).lado;
      const tamanho = tamanhoDaImagem(formato, lado, tela, limiteDeImagem(toque));
      await new Promise((ok) => setTimeout(ok, 60)); // deixa a seleção sumir e o aviso "Gerando" aparecer
      const blob = await gerarImagem(tamanho);
      const { visao, projeto } = useApp.getState();
      const vista = visao.camera === "interna" ? (projeto.vistas.find((v) => v.id === visao.vistaId)?.nome ?? "por dentro") : visao.camera === "superior" ? "planta" : "3D";
      // a prévia usa a imagem embutida (data URL): na página publicada, endereços "blob:" podem ser barrados
      setEtapa({ tipo: "pronta", url: await paraDataUrl(blob), blob, nome: nomeDoArquivo(vista, new Date()), ...tamanho });
    } catch (e) {
      setEtapa({ tipo: "erro", mensagem: e instanceof Error ? e.message : "Não foi possível gerar a imagem." });
    }
  };

  const salvar = async () => {
    if (etapa.tipo !== "pronta") return;
    const r = await salvarArquivo(etapa.blob, etapa.nome);
    const aviso = r === "salvo" ? "Imagem entregue ao aparelho." : r === "recusado" ? undefined : "Não consegui salvar por aqui. Toque e segure a imagem (ou clique com o botão direito) e escolha salvar.";
    setEtapa({ ...etapa, aviso });
  };

  return (
    <>
      <h3 className="secao">Exportar imagem</h3>
      <p className="dica">Gera uma imagem em alta resolução da vista que está na tela, sem os painéis.</p>
      <div className="linha-dupla">
        <label className="campo">
          <span className="campo-rotulo">Formato</span>
          <select id="imagem-formato" value={formato} onChange={(e) => setFormato(e.target.value as FormatoImagem)}>
            {Object.entries(NOME_FORMATO).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span className="campo-rotulo">Qualidade</span>
          <select id="imagem-qualidade" value={qualidade} onChange={(e) => setQualidade(e.target.value as typeof qualidade)}>
            {qualidades.map((q) => (
              <option key={q.id} value={q.id}>
                {q.nome}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button className="botao" onClick={gerar} disabled={etapa.tipo === "gerando"} data-teste="imagem-gerar">
        {etapa.tipo === "gerando" ? "Gerando a imagem…" : "Gerar imagem"}
      </button>
      {etapa.tipo === "erro" && (
        <div className="aviso" role="alert">
          {etapa.mensagem} Tente uma qualidade menor.
        </div>
      )}
      {etapa.tipo === "pronta" &&
        // fora do painel (direto na página), para a prévia ficar por cima de tudo: barra, vistas e botões de andar
        createPortal(
        <div className="previa" role="dialog" aria-modal="true" aria-label="Imagem gerada" data-teste="imagem-previa">
          <div className="previa-caixa">
            <img src={etapa.url} alt="Imagem gerada da vista atual" />
            <p className="previa-info">
              {etapa.largura} × {etapa.altura} pontos · {(etapa.blob.size / 1_048_576).toFixed(1).replace(".", ",")} MB
            </p>
            {etapa.aviso && (
              <p className="previa-aviso" role="status">
                {etapa.aviso}
              </p>
            )}
            <div className="linha-botoes">
              <button className="botao" onClick={salvar} data-teste="imagem-salvar">
                Salvar imagem
              </button>
              <button className="botao secundario" onClick={() => setEtapa({ tipo: "parado" })} data-teste="imagem-fechar">
                Fechar
              </button>
            </div>
            {emPaginaPublicada() && <p className="dica">O aparelho pede uma confirmação antes de salvar.</p>}
          </div>
        </div>,
          document.body,
        )}
    </>
  );
}

function Historico() {
  const passado = useApp((s) => s.passado);
  const voltar = useApp((s) => s.voltarNoHistorico);
  // do mais recente para o mais antigo, com o índice original de cada passo
  const passos = passado.map((p, i) => ({ rotulo: p.rotulo, indice: i })).reverse();
  return (
    <>
      <h3 className="secao">Histórico desta visita</h3>
      {passos.length === 0 ? (
        <p className="dica">Nada foi alterado desde que a página abriu.</p>
      ) : (
        <ol className="historico" reversed>
          {passos.slice(0, 40).map((p) => (
            <li key={p.indice}>
              <span className="historico-rotulo">{p.rotulo}</span>
              <button className="ligacao" onClick={() => voltar(p.indice)} title="Desfaz este passo e os que vieram depois" data-teste={`historico-${p.indice}`}>
                Voltar para antes
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="dica">O histórico vale enquanto a página está aberta (Ctrl+Z desfaz o último passo). O que deve ficar guardado, salve como versão.</p>
    </>
  );
}
