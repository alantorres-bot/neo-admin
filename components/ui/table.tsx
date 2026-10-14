"use client"

/**
 * Grade padrão do Neo Admin. Toda tabela já nasce com classificação e filtro:
 * - clicar no título da coluna classifica (crescente → decrescente → ordem original);
 * - o funil do título filtra a coluna (trecho de texto ou valores marcados, como no Excel);
 * - a partir de 8 linhas aparece a busca geral "Filtrar nesta tabela".
 * Funciona sobre o texto exibido nas células (datas dd/mm/aaaa, R$ 1.234,56 e texto), sem configurar colunas.
 * Títulos vazios ou com link/botão/caixa ficam de fora. Coluna com classificação própria (ex.: no servidor, que vale
 * para todas as páginas) marca o controle com `data-ordem-externa`: mantém a classificação dela e ganha o funil.
 * Grade com "marcar todos" no cabeçalho só filtra se passar `aoFiltrar`: recebe as chaves (key) das linhas visíveis
 * (null = sem filtro) para o "marcar todos" marcar só o que está à vista.
 * Linhas com célula mesclada (colSpan) ficam sempre visíveis: avisos, subtotais, títulos de grupo.
 * `<Table interativa={false}>` desliga tudo (use só em quadros que não são grade, ex.: resumo de totais).
 */

import * as React from "react"
import { Popover } from "@base-ui/react/popover"
import { ArrowDown, ArrowUp, ArrowUpDown, Funnel, Search } from "lucide-react"
import { cn } from "cn"
import {
  filtroAtivo, linhaPassa, normalizar, ordenarIndices, valoresDistintos,
  type Direcao, type FiltroColuna,
} from "@/lib/nucleo/tabela"

type Ordem = { coluna: number; direcao: Direcao } | null
type Medicao = { linhas: string[][]; total: number; visiveis: number; ordenavel: boolean; mapeado: boolean }

type ContextoTabela = {
  ordem: Ordem
  setOrdem: (o: Ordem) => void
  filtros: Record<number, FiltroColuna>
  setFiltro: (coluna: number, f: FiltroColuna | null) => void
  busca: string
  filtroPermitido: boolean
  colunas: number
  medicao: Medicao
  publicar: (m: Medicao) => void
  informarVisiveis: (chaves: string[] | null) => void
}

const Contexto = React.createContext<ContextoTabela | null>(null)

/** A partir de quantas linhas a busca geral aparece sozinha. */
const LINHAS_PARA_BUSCA = 8
/** Acima disso a lista de valores do funil mostra só os primeiros (o campo "Contém" continua valendo). */
const MAX_VALORES_LISTA = 200

function mesmaMedicao(a: Medicao, b: Medicao) {
  return a.total === b.total && a.visiveis === b.visiveis && a.ordenavel === b.ordenavel && a.mapeado === b.mapeado && JSON.stringify(a.linhas) === JSON.stringify(b.linhas)
}

type PropsTabela = React.ComponentProps<"table"> & {
  interativa?: boolean
  /** Obrigatório para filtrar grade com "marcar todos": chaves das linhas visíveis, ou null quando nada está filtrado. */
  aoFiltrar?: (chaves: string[] | null) => void
}

function Table({ className, interativa = true, aoFiltrar, children, ...props }: PropsTabela) {
  const ref = React.useRef<HTMLTableElement>(null)
  const [ordem, setOrdem] = React.useState<Ordem>(null)
  const [filtros, setFiltros] = React.useState<Record<number, FiltroColuna>>({})
  const [busca, setBusca] = React.useState("")
  const [estrutura, setEstrutura] = React.useState({ colunas: 0, comSelecao: false })
  const [medicao, setMedicao] = React.useState<Medicao>({ linhas: [], total: 0, visiveis: 0, ordenavel: false, mapeado: false })
  const aoFiltrarRef = React.useRef(aoFiltrar)
  const informado = React.useRef<string | undefined>(undefined)
  React.useEffect(() => { aoFiltrarRef.current = aoFiltrar })

  // Estrutura lida do cabeçalho já desenhado: nº de colunas e se há "marcar todos".
  // eslint-disable-next-line react-hooks/exhaustive-deps -- relê o DOM a cada desenho; o estado só muda quando o valor lido muda
  React.useLayoutEffect(() => {
    const t = ref.current
    if (!interativa || !t) return
    const cab = t.tHead?.rows[t.tHead.rows.length - 1]
    const colunas = cab ? Array.from(cab.cells).reduce((s, c) => s + c.colSpan, 0) : 0
    const comSelecao = !!t.tHead?.querySelector("input[type=checkbox],[role=checkbox]")
    setEstrutura((e) => (e.colunas === colunas && e.comSelecao === comSelecao ? e : { colunas, comSelecao }))
  })

  const setFiltro = React.useCallback((coluna: number, f: FiltroColuna | null) => {
    setFiltros((atual) => {
      const novo = { ...atual }
      if (f && filtroAtivo(f)) novo[coluna] = f
      else delete novo[coluna]
      return novo
    })
  }, [])
  const publicar = React.useCallback((m: Medicao) => setMedicao((atual) => (mesmaMedicao(atual, m) ? atual : m)), [])
  const informarVisiveis = React.useCallback((chaves: string[] | null) => {
    const assinatura = chaves === null ? "" : JSON.stringify(chaves)
    if (informado.current === assinatura) return
    informado.current = assinatura
    aoFiltrarRef.current?.(chaves)
  }, [])

  // Com "marcar todos", só filtra quem sabe marcar apenas as linhas visíveis (aoFiltrar) e com as linhas identificadas.
  const filtroPermitido = !estrutura.comSelecao || (!!aoFiltrar && medicao.mapeado)
  const valor = React.useMemo<ContextoTabela>(
    () => ({ ordem, setOrdem, filtros, setFiltro, busca, publicar, informarVisiveis, medicao, colunas: estrutura.colunas, filtroPermitido }),
    [ordem, filtros, setFiltro, busca, publicar, informarVisiveis, medicao, estrutura.colunas, filtroPermitido],
  )

  const algumFiltro = busca.trim() !== "" || Object.keys(filtros).length > 0
  const mostrarBarra = interativa && filtroPermitido && (medicao.total >= LINHAS_PARA_BUSCA || algumFiltro)

  const tabela = (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      {mostrarBarra && (
        <div data-slot="table-filtros" className="sticky left-0 mb-1.5 flex flex-wrap items-center gap-2 print:hidden">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Filtrar nesta tabela…"
              aria-label="Filtrar nesta tabela"
              className="h-7 w-60 rounded-[3px] border border-input bg-white pr-2 pl-7 text-[12px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          {algumFiltro && (
            <>
              <span className="text-[12px] text-muted-foreground">
                {medicao.visiveis} de {medicao.total} {medicao.total === 1 ? "linha" : "linhas"}
              </span>
              <button
                type="button"
                onClick={() => { setBusca(""); setFiltros({}) }}
                className="text-[12px] text-elo hover:underline"
              >
                Limpar filtros
              </button>
            </>
          )}
        </div>
      )}
      <table ref={ref} data-slot="table" className={cn("w-full caption-bottom text-[13px]", className)} {...props}>
        {children}
      </table>
    </div>
  )
  return interativa ? <Contexto.Provider value={valor}>{tabela}</Contexto.Provider> : tabela
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-cabecalho [&_tr]:border-b [&_tr]:border-grade", className)}
      {...props}
    />
  )
}

/** Texto da célula como o usuário vê: campos e listas pelo valor escolhido; ícones e caixas de marcar não contam. */
function textoDe(no: Node): string {
  if (no.nodeType === Node.TEXT_NODE) return no.textContent ?? ""
  if (!(no instanceof HTMLElement)) return ""
  if (no.hidden || no.dataset.tabelaIgnorar !== undefined) return ""
  if (no instanceof HTMLInputElement) return no.type === "checkbox" || no.type === "radio" || no.type === "hidden" ? "" : no.value
  if (no instanceof HTMLSelectElement) return no.selectedOptions[0]?.text ?? ""
  if (no instanceof HTMLTextAreaElement) return no.value
  if (no instanceof HTMLBRElement) return " "
  let t = ""
  for (const filho of Array.from(no.childNodes)) t += textoDe(filho)
  return t
}

/** Valores da linha por coluna; a célula mesclada ocupa as colunas seguintes com vazio. */
function celulasDe(tr: HTMLTableRowElement): string[] {
  const valores: string[] = []
  for (const c of Array.from(tr.cells)) {
    valores.push(textoDe(c))
    for (let i = 1; i < c.colSpan; i++) valores.push("")
  }
  return valores
}

/** Desfaz o prefixo e o escape que React.Children.toArray põe na key (".$" e "=0"/"=2"). */
function chaveOriginal(chave: string): string {
  return chave.replace(/^\.\$/, "").replace(/=2/g, ":").replace(/=0/g, "=")
}

type Grupo = { chave: string; elemento: React.ReactNode; tamanho: number }
type Leitura = { porChave: Record<string, string[]>; fixas: string[]; ordenavel: boolean; assinatura: string }

/** Cada filho do corpo é uma unidade de classificação; um Fragment com várias linhas (linha + detalhe) anda junto. */
function gruposDe(children: React.ReactNode): Grupo[] {
  return React.Children.toArray(children).map((el, i) => {
    const valido = React.isValidElement(el)
    const tamanho = valido && el.type === React.Fragment
      ? React.Children.toArray((el.props as { children?: React.ReactNode }).children).length
      : 1
    return { chave: valido && el.key != null ? String(el.key) : `#${i}`, elemento: el, tamanho }
  })
}

function TableBody({ className, children, ...props }: React.ComponentProps<"tbody">) {
  const ctx = React.useContext(Contexto)
  const ref = React.useRef<HTMLTableSectionElement>(null)
  const [leitura, setLeitura] = React.useState<Leitura>({ porChave: {}, fixas: [], ordenavel: false, assinatura: "" })

  const grupos = ctx ? gruposDe(children) : []
  let ordenados = grupos
  if (ctx?.ordem && leitura.ordenavel) {
    const dados = grupos.filter((g) => leitura.porChave[g.chave] && !leitura.fixas.includes(g.chave))
    const resto = grupos.filter((g) => !dados.includes(g))
    const ordem = ordenarIndices(dados.map((g) => leitura.porChave[g.chave]), ctx.ordem.coluna, ctx.ordem.direcao)
    ordenados = [...ordem.map((i) => dados[i]), ...resto]
  }

  // Depois de cada desenho: lê o texto das linhas, esconde as que não passam no filtro e informa a tabela.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- relê o DOM a cada desenho; o estado só muda quando o valor lido muda
  React.useLayoutEffect(() => {
    const tbody = ref.current
    if (!ctx || !tbody) return
    const trs = Array.from(tbody.rows).filter((tr) => !tr.hasAttribute("data-tabela-aviso"))
    const mapeado = trs.length === ordenados.reduce((s, g) => s + g.tamanho, 0)
    let unidades: { chave: string; trs: HTMLTableRowElement[] }[]
    if (mapeado) {
      let p = 0
      unidades = ordenados.map((g) => {
        const u = { chave: g.chave, trs: trs.slice(p, p + g.tamanho) }
        p += g.tamanho
        return u
      })
    } else {
      // Filho que desenha mais de uma linha sem Fragment: sem classificação, filtro linha a linha.
      unidades = trs.map((tr, i) => ({ chave: `tr${i}`, trs: [tr] }))
    }

    const porChave: Record<string, string[]> = {}
    const fixas: string[] = []
    for (const u of unidades) {
      if (!u.trs[0]) continue
      if (Array.from(u.trs[0].cells).some((c) => c.colSpan > 1)) fixas.push(u.chave)
      porChave[u.chave] = celulasDe(u.trs[0])
    }
    // Linhas fixas (subtotal, aviso) só não impedem a classificação se estiverem todas no fim.
    const originais = mapeado ? grupos.map((g) => g.chave) : unidades.map((u) => u.chave)
    const primeiraFixa = originais.findIndex((c) => fixas.includes(c))
    const ordenavel = mapeado && (primeiraFixa === -1 || originais.slice(primeiraFixa).every((c) => fixas.includes(c)))

    const filtros = ctx.filtroPermitido ? ctx.filtros : {}
    const busca = ctx.filtroPermitido ? ctx.busca : ""
    const linhas: string[][] = []
    const chavesVisiveis: string[] = []
    let visiveis = 0
    for (const u of unidades) {
      const fixa = fixas.includes(u.chave)
      const valores = porChave[u.chave] ?? []
      const passa = fixa || linhaPassa(valores, filtros, busca)
      if (!fixa && u.trs.length) {
        linhas.push(valores)
        if (passa) {
          visiveis++
          chavesVisiveis.push(chaveOriginal(u.chave))
        }
      }
      for (const tr of u.trs) {
        if (!passa) {
          tr.hidden = true
          tr.dataset.tabelaOculta = ""
        } else if (tr.dataset.tabelaOculta !== undefined) {
          tr.hidden = false
          delete tr.dataset.tabelaOculta
        }
      }
    }

    const assinatura = JSON.stringify([porChave, fixas, ordenavel])
    setLeitura((l) => (l.assinatura === assinatura ? l : { porChave, fixas, ordenavel, assinatura }))
    ctx.publicar({ linhas, total: linhas.length, visiveis, ordenavel, mapeado })
    const algumFiltro = busca.trim() !== "" || Object.keys(filtros).length > 0
    ctx.informarVisiveis(algumFiltro && mapeado ? chavesVisiveis : null)
  })

  const semResultado = !!ctx && ctx.filtroPermitido && ctx.medicao.total > 0 && ctx.medicao.visiveis === 0
  return (
    <tbody
      ref={ref}
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    >
      {ctx ? ordenados.map((g) => g.elemento) : children}
      {semResultado && (
        <tr data-tabela-aviso="">
          <td colSpan={Math.max(ctx.colunas, 1)} className="px-2 py-3 text-center text-muted-foreground">
            Nenhuma linha atende ao filtro.
          </td>
        </tr>
      )}
    </tbody>
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-grade-clara transition-colors hover:bg-cabecalho has-aria-expanded:bg-cabecalho data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

const SELETOR_INTERATIVO = "a,button,input,select,textarea,[role=checkbox],[role=button],[role=combobox]"

function TableHead({ className, children, ...props }: React.ComponentProps<"th">) {
  const ctx = React.useContext(Contexto)
  const ref = React.useRef<HTMLTableCellElement>(null)
  const [coluna, setColuna] = React.useState<{ indice: number; rotulo: string; externa: boolean } | null>(null)

  // Só o título da última linha do cabeçalho, com texto e sem controles próprios, vira classificável.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- relê o DOM a cada desenho; o estado só muda quando o valor lido muda
  React.useLayoutEffect(() => {
    const th = ref.current
    let c: { indice: number; rotulo: string; externa: boolean } | null = null
    const rotulo = th?.querySelector<HTMLElement>(":scope > [data-tabela-rotulo]")
    const thead = th?.closest("thead")
    const tr = th?.parentElement
    const texto = rotulo ? textoDe(rotulo).replace(/\s+/g, " ").trim() : ""
    // Classificação própria da tela (link/botão marcado com data-ordem-externa): fica a dela, e a coluna ganha o funil.
    const externa = !!rotulo?.querySelector("[data-ordem-externa]")
    const outrosControles = rotulo ? Array.from(rotulo.querySelectorAll(SELETOR_INTERATIVO)).filter((el) => !el.closest("[data-ordem-externa]")) : []
    if (ctx && th && rotulo && thead && tr && thead.rows[thead.rows.length - 1] === tr && th.colSpan === 1 && texto && outrosControles.length === 0) {
      let indice = 0
      for (let irmao = th.previousElementSibling; irmao; irmao = irmao.previousElementSibling) {
        indice += (irmao as HTMLTableCellElement).colSpan || 1
      }
      c = { indice, rotulo: texto, externa }
    }
    setColuna((atual) => (atual?.indice === c?.indice && atual?.rotulo === c?.rotulo && atual?.externa === c?.externa ? atual : c))
  })

  const classe = cn(
    "h-8 px-2 text-left align-middle text-[12px] font-bold whitespace-nowrap text-texto [&:has([role=checkbox])]:pr-0",
    className
  )
  if (!ctx) {
    return <th data-slot="table-head" className={classe} {...props}>{children}</th>
  }

  const classificavel = !!coluna && !coluna.externa && ctx.medicao.ordenavel
  const direcao = classificavel && ctx.ordem?.coluna === coluna.indice ? ctx.ordem.direcao : null
  const alternar = () => {
    if (!coluna || !classificavel) return
    ctx.setOrdem(direcao === null ? { coluna: coluna.indice, direcao: "asc" } : direcao === "asc" ? { coluna: coluna.indice, direcao: "desc" } : null)
  }
  const Seta = direcao === "asc" ? ArrowUp : direcao === "desc" ? ArrowDown : ArrowUpDown
  const titulo = coluna && classificavel
    ? direcao === "asc" ? `${coluna.rotulo}: crescente (clique para decrescente)`
      : direcao === "desc" ? `${coluna.rotulo}: decrescente (clique para voltar à ordem original)`
      : `Classificar por ${coluna.rotulo}`
    : undefined

  return (
    <th
      ref={ref}
      data-slot="table-head"
      aria-sort={direcao === "asc" ? "ascending" : direcao === "desc" ? "descending" : undefined}
      className={cn(classe, classificavel && "group/cabecalho")}
      {...props}
    >
      <span
        data-tabela-rotulo=""
        {...(classificavel
          ? {
              role: "button",
              tabIndex: 0,
              title: titulo,
              onClick: alternar,
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternar() }
              },
              className: "cursor-pointer select-none hover:underline",
            }
          : {})}
      >
        {children}
      </span>
      {coluna && (classificavel || ctx.filtroPermitido) && (
        <span className="ml-0.5 inline-flex items-center align-middle print:hidden">
          {classificavel && (
            <Seta
              aria-hidden
              onClick={alternar}
              className={cn("size-3.5 cursor-pointer", direcao ? "text-foreground" : "opacity-0 group-hover/cabecalho:opacity-40")}
            />
          )}
          {ctx.filtroPermitido && <FiltroDaColuna coluna={coluna.indice} rotulo={coluna.rotulo} classificavel={classificavel} />}
        </span>
      )}
    </th>
  )
}

function FiltroDaColuna({ coluna, rotulo, classificavel }: { coluna: number; rotulo: string; classificavel: boolean }) {
  const ctx = React.useContext(Contexto)!
  const ativo = filtroAtivo(ctx.filtros[coluna])
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`Filtrar ${rotulo}`}
        title={ativo ? `${rotulo}: filtro ativo` : `Filtrar ${rotulo}`}
        className={cn(
          "inline-flex size-5 items-center justify-center rounded-[3px] hover:bg-black/5",
          ativo ? "text-marca" : "text-muted-foreground opacity-40 hover:opacity-100 data-popup-open:opacity-100"
        )}
      >
        <Funnel className="size-3" fill={ativo ? "currentColor" : "none"} aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} className="isolate z-50 outline-none">
          <Popover.Popup className="w-64 rounded-md bg-popover p-2 text-[12px] font-normal text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none">
            <ConteudoFiltro coluna={coluna} classificavel={classificavel} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function ConteudoFiltro({ coluna, classificavel }: { coluna: number; classificavel: boolean }) {
  const ctx = React.useContext(Contexto)!
  const atual = ctx.filtros[coluna] ?? { texto: "", valores: null }
  const distintos = React.useMemo(() => valoresDistintos(ctx.medicao.linhas, coluna), [ctx.medicao.linhas, coluna])
  const busca = normalizar(atual.texto)
  const listados = distintos.filter((d) => !busca || normalizar(d.valor).includes(busca))
  const marcados = atual.valores === null ? null : new Set(atual.valores)
  const todos = marcados === null

  const alternarValor = (valor: string) => {
    const base = marcados ?? new Set(distintos.map((d) => d.valor))
    const novo = new Set(base)
    if (novo.has(valor)) novo.delete(valor)
    else novo.add(valor)
    const todosMarcados = distintos.every((d) => novo.has(d.valor))
    ctx.setFiltro(coluna, { ...atual, valores: todosMarcados ? null : [...novo] })
  }
  const ordenar = (direcao: Direcao) => ctx.setOrdem({ coluna, direcao })
  const direcao = ctx.ordem?.coluna === coluna ? ctx.ordem.direcao : null
  const botao = "flex w-full items-center gap-1.5 rounded-[3px] px-1.5 py-1 text-left hover:bg-cabecalho"

  return (
    <div className="flex flex-col gap-1.5">
      {classificavel && <div className="flex flex-col">
        <button type="button" className={cn(botao, direcao === "asc" && "font-bold")} onClick={() => ordenar("asc")}>
          <ArrowUp className="size-3.5" aria-hidden /> Classificar crescente
        </button>
        <button type="button" className={cn(botao, direcao === "desc" && "font-bold")} onClick={() => ordenar("desc")}>
          <ArrowDown className="size-3.5" aria-hidden /> Classificar decrescente
        </button>
      </div>}
      <input
        type="search"
        autoFocus
        value={atual.texto}
        onChange={(e) => ctx.setFiltro(coluna, { ...atual, texto: e.target.value })}
        placeholder="Contém…"
        aria-label="Contém"
        className="h-7 w-full rounded-[3px] border border-input bg-white px-2 text-[12px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <div className="max-h-56 overflow-y-auto rounded-[3px] border border-grade-clara p-1">
        <label className="flex items-center gap-1.5 px-1 py-0.5 font-bold">
          <input
            type="checkbox"
            checked={todos}
            onChange={() => ctx.setFiltro(coluna, { ...atual, valores: todos ? [] : null })}
          />
          (Selecionar todos)
        </label>
        {listados.slice(0, MAX_VALORES_LISTA).map((d) => (
          <label key={d.valor} className="flex items-center gap-1.5 px-1 py-0.5">
            <input type="checkbox" checked={marcados === null || marcados.has(d.valor)} onChange={() => alternarValor(d.valor)} />
            <span className={cn("truncate", !d.valor && "text-muted-foreground italic")}>{d.valor || "(vazio)"}</span>
            <span className="ml-auto text-muted-foreground">{d.quantidade}</span>
          </label>
        ))}
        {listados.length > MAX_VALORES_LISTA && (
          <p className="px-1 py-0.5 text-muted-foreground">
            +{listados.length - MAX_VALORES_LISTA} valores — use o campo &quot;Contém&quot;.
          </p>
        )}
        {listados.length === 0 && <p className="px-1 py-0.5 text-muted-foreground">Nenhum valor.</p>}
      </div>
      <button
        type="button"
        disabled={!filtroAtivo(ctx.filtros[coluna])}
        onClick={() => ctx.setFiltro(coluna, null)}
        className="self-end text-elo hover:underline disabled:pointer-events-none disabled:opacity-40"
      >
        Limpar filtro da coluna
      </button>
    </div>
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-2 py-1.5 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

/**
 * Para grades com "marcar todos": `<Table aoFiltrar={aoFiltrar}>` e `visivel(key)` diz se a linha está à vista,
 * para o "marcar todos" marcar só o que o filtro deixou aparecer.
 */
function useLinhasVisiveis() {
  const [chaves, setChaves] = React.useState<Set<string> | null>(null)
  const aoFiltrar = React.useCallback((c: string[] | null) => setChaves(c && new Set(c)), [])
  const visivel = React.useCallback((chave: string) => chaves === null || chaves.has(chave), [chaves])
  return { visivel, aoFiltrar }
}

export {
  useLinhasVisiveis,
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
