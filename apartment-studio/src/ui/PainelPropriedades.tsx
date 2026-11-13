import { useApp } from "../estado/store";
import { areaAmbienteM2, comprimentoParede, definirComprimento, validarPlanta } from "../modelo/geometria";
import type { Abertura, Ambiente, Medida, Parede, Planta, TipoAbertura, TipoAmbiente } from "../modelo/tipos";
import { CampoMedida, CampoNumero, SeloOrigem } from "./campos";
import { NOME_TIPO_ABERTURA, NOME_TIPO_AMBIENTE, nomeAbertura, nomeParede } from "./nomes";
import { fmtM2 } from "./PainelLateral";

export function PainelPropriedades() {
  const selecao = useApp((s) => s.selecao);
  const planta = useApp((s) => s.projeto.planta);

  let corpo: React.ReactNode = <Geral planta={planta} />;
  if (selecao?.tipo === "parede") {
    const p = planta.paredes.find((x) => x.id === selecao.id);
    if (p) corpo = <PropParede planta={planta} parede={p} />;
  } else if (selecao?.tipo === "abertura") {
    const a = planta.aberturas.find((x) => x.id === selecao.id);
    if (a) corpo = <PropAbertura planta={planta} ab={a} />;
  } else if (selecao?.tipo === "ambiente") {
    const a = planta.ambientes.find((x) => x.id === selecao.id);
    if (a) corpo = <PropAmbiente planta={planta} amb={a} />;
  }
  return (
    <aside className="painel painel-dir" data-teste="propriedades">
      {corpo}
    </aside>
  );
}

function Geral({ planta }: { planta: Planta }) {
  const alterarPlanta = useApp((s) => s.alterarPlanta);
  const problemas = validarPlanta(planta);
  return (
    <>
      <h2 className="titulo">Apartamento</h2>
      <p className="dica">Clique numa parede, porta, janela ou piso para ver e corrigir as medidas.</p>
      <CampoMedida
        rotulo="Pé-direito"
        medida={planta.peDireito}
        min={200}
        aoAlterar={(peDireito) => alterarPlanta("Alterar pé-direito", (p) => ({ ...p, peDireito }))}
      />
      <div className="legenda">
        <p>Origem das medidas:</p>
        <p><SeloOrigem origem="cota" /> lida na planta</p>
        <p><SeloOrigem origem="derivada" /> calculada a partir de cotas</p>
        <p><SeloOrigem origem="estimada" /> estimativa, conferir</p>
        <p><SeloOrigem origem="manual" /> informada por você</p>
      </div>
      {problemas.length > 0 && (
        <div className="aviso">
          {problemas.map((p, i) => (
            <p key={i}>{p.mensagem}</p>
          ))}
        </div>
      )}
    </>
  );
}

function PropParede({ planta, parede }: { planta: Planta; parede: Parede }) {
  const alterarPlanta = useApp((s) => s.alterarPlanta);
  const selecionar = useApp((s) => s.selecionar);
  const L = comprimentoParede(planta, parede);
  const va = planta.vertices.find((v) => v.id === parede.a)!;
  const vb = planta.vertices.find((v) => v.id === parede.b)!;
  const aberturas = planta.aberturas.filter((a) => a.paredeId === parede.id);

  const alterar = (rotulo: string, p: Partial<Parede>) =>
    alterarPlanta(rotulo, (pl) => ({ ...pl, paredes: pl.paredes.map((x) => (x.id === parede.id ? { ...x, ...p } : x)) }));

  const moverVertice = (id: string, eixo: "x" | "y", valor: number) =>
    alterarPlanta("Mover canto", (pl) => ({
      ...pl,
      vertices: pl.vertices.map((v) => (v.id === id ? { ...v, [eixo]: valor, origem: "manual" } : v)),
    }));

  const adicionar = (tipo: TipoAbertura) => {
    const id = `${tipo}-${Date.now().toString(36)}`;
    const janela = tipo === "janela";
    const nova: Abertura = {
      id,
      paredeId: parede.id,
      tipo,
      posicao: { valor: Math.round(L / 2), origem: "manual" },
      largura: { valor: janela ? 120 : 80, origem: "estimada" },
      altura: { valor: janela ? 120 : 210, origem: "estimada" },
      peitoril: { valor: janela ? 100 : 0, origem: "estimada" },
      ...(tipo === "porta" ? { dobradica: "inicio" as const, abrePara: "esquerda" as const } : {}),
    };
    alterarPlanta(`Adicionar ${NOME_TIPO_ABERTURA[tipo].toLowerCase()}`, (pl) => ({ ...pl, aberturas: [...pl.aberturas, nova] }));
    selecionar({ tipo: "abertura", id });
  };

  return (
    <>
      <p className="tipo">Parede</p>
      <h2 className="titulo">{nomeParede(planta, parede)}</h2>
      <CampoNumero
        rotulo="Comprimento"
        valor={Math.round(L * 10) / 10}
        min={1}
        aoConfirmar={(v) => alterarPlanta("Alterar comprimento da parede", (pl) => definirComprimento(pl, parede.id, v))}
        extra={<SeloOrigem origem={va.origem === "estimada" || vb.origem === "estimada" ? "estimada" : va.origem === "cota" && vb.origem === "cota" ? "cota" : "manual"} />}
      />
      <p className="dica">Alterar o comprimento move o canto {parede.b}; as paredes ligadas a ele acompanham.</p>
      <CampoMedida rotulo="Espessura" medida={parede.espessura} min={3} aoAlterar={(espessura) => alterar("Alterar espessura", { espessura })} />
      {parede.altura ? (
        <CampoMedida rotulo="Altura" medida={parede.altura} min={10} aoAlterar={(altura) => alterar("Alterar altura", { altura })} />
      ) : (
        <p className="dica">Altura: pé-direito ({planta.peDireito.valor} cm).</p>
      )}

      <h3 className="secao">Cantos (posição em cm)</h3>
      {[va, vb].map((v) => (
        <div className="linha-dupla" key={v.id}>
          <CampoNumero rotulo={`${v.id} · x`} valor={v.x} aoConfirmar={(n) => moverVertice(v.id, "x", n)} />
          <CampoNumero rotulo="y" valor={v.y} aoConfirmar={(n) => moverVertice(v.id, "y", n)} />
        </div>
      ))}

      <h3 className="secao">Portas e janelas nesta parede</h3>
      <ul className="lista compacta">
        {aberturas.map((a) => (
          <li key={a.id}>
            <button className="item" onClick={() => selecionar({ tipo: "abertura", id: a.id })}>
              <span className="item-nome">{NOME_TIPO_ABERTURA[a.tipo]}</span>
              <span className="item-valor">{a.largura.valor} cm</span>
            </button>
          </li>
        ))}
        {aberturas.length === 0 && <li className="dica">Nenhuma.</li>}
      </ul>
      <div className="linha-botoes">
        <button className="botao secundario" onClick={() => adicionar("porta")}>+ Porta</button>
        <button className="botao secundario" onClick={() => adicionar("janela")}>+ Janela</button>
        <button className="botao secundario" onClick={() => adicionar("vao")}>+ Vão</button>
      </div>
    </>
  );
}

function PropAbertura({ planta, ab }: { planta: Planta; ab: Abertura }) {
  const alterarPlanta = useApp((s) => s.alterarPlanta);
  const selecionar = useApp((s) => s.selecionar);
  const parede = planta.paredes.find((p) => p.id === ab.paredeId);
  const L = parede ? comprimentoParede(planta, parede) : 0;
  const alterar = (rotulo: string, p: Partial<Abertura>) =>
    alterarPlanta(rotulo, (pl) => ({ ...pl, aberturas: pl.aberturas.map((x) => (x.id === ab.id ? { ...x, ...p } : x)) }));
  const med = (campo: "posicao" | "largura" | "altura" | "peitoril", rotulo: string) => (m: Medida) =>
    alterar(`Alterar ${rotulo.toLowerCase()}`, { [campo]: m });

  const problemas = validarPlanta(planta).filter((p) => p.ref === ab.id);

  return (
    <>
      <p className="tipo">{NOME_TIPO_ABERTURA[ab.tipo]}</p>
      <h2 className="titulo">{nomeAbertura(planta, ab)}</h2>
      <label className="campo">
        <span className="campo-rotulo">Tipo</span>
        <select value={ab.tipo} onChange={(e) => alterar("Alterar tipo", { tipo: e.target.value as TipoAbertura })}>
          {Object.entries(NOME_TIPO_ABERTURA).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </label>
      <CampoMedida rotulo="Largura" medida={ab.largura} min={10} aoAlterar={med("largura", "Largura")} />
      <CampoMedida rotulo="Altura" medida={ab.altura} min={10} aoAlterar={med("altura", "Altura")} />
      <CampoMedida rotulo="Peitoril (do piso)" medida={ab.peitoril} aoAlterar={med("peitoril", "Peitoril")} />
      <CampoMedida rotulo="Centro a partir do canto" medida={ab.posicao} aoAlterar={med("posicao", "Posição")} />
      <p className="dica">
        Distância do canto {parede?.a} até o centro da abertura. A parede tem {Math.round(L)} cm.
      </p>
      {ab.tipo === "porta" && (
        <div className="linha-botoes">
          <button className="botao secundario" onClick={() => alterar("Inverter dobradiça", { dobradica: ab.dobradica === "fim" ? "inicio" : "fim" })}>
            Inverter dobradiça
          </button>
          <button className="botao secundario" onClick={() => alterar("Inverter abertura", { abrePara: ab.abrePara === "direita" ? "esquerda" : "direita" })}>
            Abrir para o outro lado
          </button>
        </div>
      )}
      {problemas.length > 0 && (
        <div className="aviso">
          {problemas.map((p, i) => <p key={i}>{p.mensagem}</p>)}
        </div>
      )}
      <button
        className="botao perigo"
        onClick={() => {
          alterarPlanta("Excluir abertura", (pl) => ({ ...pl, aberturas: pl.aberturas.filter((x) => x.id !== ab.id) }));
          selecionar(parede ? { tipo: "parede", id: parede.id } : null);
        }}
      >
        Excluir {NOME_TIPO_ABERTURA[ab.tipo].toLowerCase()}
      </button>
    </>
  );
}

function PropAmbiente({ planta, amb }: { planta: Planta; amb: Ambiente }) {
  const alterarPlanta = useApp((s) => s.alterarPlanta);
  const definirVisao = useApp((s) => s.definirVisao);
  const alterar = (rotulo: string, p: Partial<Ambiente>) =>
    alterarPlanta(rotulo, (pl) => ({ ...pl, ambientes: pl.ambientes.map((x) => (x.id === amb.id ? { ...x, ...p } : x)) }));
  const area = areaAmbienteM2(planta, amb);
  const dif = amb.areaInformada ? ((area - amb.areaInformada) / amb.areaInformada) * 100 : null;

  return (
    <>
      <p className="tipo">Ambiente</p>
      <label className="campo">
        <span className="campo-rotulo">Nome</span>
        <input defaultValue={amb.nome} key={amb.id} onBlur={(e) => e.target.value.trim() && e.target.value !== amb.nome && alterar("Renomear ambiente", { nome: e.target.value.trim() })} />
      </label>
      <label className="campo">
        <span className="campo-rotulo">Tipo</span>
        <select value={amb.tipo} onChange={(e) => alterar("Alterar tipo de ambiente", { tipo: e.target.value as TipoAmbiente })}>
          {Object.entries(NOME_TIPO_AMBIENTE).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </label>
      <p className="area">
        Área calculada <strong>≈ {fmtM2(area)}</strong>
        <span className="dica"> pelo eixo das paredes</span>
      </p>
      <CampoNumero
        rotulo="Área escrita na planta"
        unidade="m²"
        passo={0.01}
        valor={amb.areaInformada ?? 0}
        aoConfirmar={(v) => alterar("Informar área da planta", { areaInformada: v || undefined })}
      />
      {dif !== null && Math.abs(dif) > 3 && (
        <div className="aviso">A área calculada difere {dif.toFixed(1).replace(".", ",")}% da área da planta. Confira as medidas.</div>
      )}
      <label className="campo">
        <span className="campo-rotulo">Cor do piso</span>
        <input type="color" value={amb.piso ?? "#cccccc"} onChange={(e) => alterar("Cor do piso", { piso: e.target.value })} />
      </label>
      <p className="dica">Materiais e texturas (madeira, porcelanato, mármore) entram na Etapa 5.</p>
      <button className="botao" onClick={() => definirVisao({ camera: "interna", ambienteInterno: amb.id })}>
        Entrar neste ambiente
      </button>
    </>
  );
}
