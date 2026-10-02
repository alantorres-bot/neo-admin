"use client";

import { useMemo, useState, useTransition } from "react";
import { FileSpreadsheet, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TAMANHO_MAXIMO_IMPORTACAO, lerArquivo, type Planilha } from "@/lib/integracoes/importador/ler-arquivo";
import {
  aplicarMapeamento, criarModelo, detectarLinhaCabecalho, extrairTabela, lerCamposDestino, lerModelo,
  reaproveitarModelo, sugerirMapeamento, validarMapeamento, type Tabela,
} from "@/lib/integracoes/importador/tabela";
import { registrarImportacao, salvarModeloImportacao } from "./acoes";

export type ModeloSalvo = { id: string; modulo: string; tipo: string; nome: string; mapeamento: unknown };

const selecao = "h-8 rounded-lg border bg-background px-2 text-sm";

function Secao({ numero, titulo, children }: { numero: number; titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="font-medium"><span className="mr-2 text-muted-foreground">{numero}.</span>{titulo}</h2>
      {children}
    </section>
  );
}

export function ImportadorGenerico({ modulos, modelos }: { modulos: { codigo: string; nome: string }[]; modelos: ModeloSalvo[] }) {
  const [modulo, setModulo] = useState(modulos[0]?.codigo ?? "");
  const [tipo, setTipo] = useState("");
  const [camposTexto, setCamposTexto] = useState("");

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [planilhas, setPlanilhas] = useState<Planilha[]>([]);
  const [indice, setIndice] = useState(0);
  const [linhaCabecalho, setLinhaCabecalho] = useState(0);
  const [delimitador, setDelimitador] = useState("");
  const [erroLeitura, setErroLeitura] = useState("");
  const [lendo, setLendo] = useState(false);

  const [mapa, setMapa] = useState<Record<string, string>>({});
  const [avisoModelo, setAvisoModelo] = useState("");
  const [nomeModelo, setNomeModelo] = useState("");
  const [pendente, iniciar] = useTransition();

  const campos = useMemo(() => lerCamposDestino(camposTexto), [camposTexto]);
  const tabela: Tabela | null = useMemo(
    () => (planilhas[indice] ? extrairTabela(planilhas[indice].matriz, linhaCabecalho) : null),
    [planilhas, indice, linhaCabecalho],
  );
  const modelosDoTipo = useMemo(() => modelos.filter((m) => m.modulo === modulo && m.tipo === tipo.trim()), [modelos, modulo, tipo]);
  const problemas = useMemo(() => validarMapeamento(mapa, campos), [mapa, campos]);
  const previa = useMemo(() => (tabela ? aplicarMapeamento(tabela, mapa).slice(0, 8) : []), [tabela, mapa]);
  const camposMapeados = campos.filter((c) => Object.values(mapa).includes(c.chave));
  const tipoValido = /^[a-z0-9_]{2,60}$/.test(tipo.trim());
  const pronto = Boolean(tabela) && camposMapeados.length > 0 && problemas.length === 0 && tipoValido && modulo !== "";

  async function carregar(file: File, delim: string) {
    setLendo(true);
    setErroLeitura("");
    const r = await lerArquivo(file, { delimitador: delim || undefined });
    setLendo(false);
    if (!r.ok) {
      setErroLeitura(r.erro);
      setPlanilhas([]);
      setMapa({});
      return;
    }
    const primeira = r.planilhas[0];
    const cabecalho = detectarLinhaCabecalho(primeira.matriz);
    setPlanilhas(r.planilhas);
    setIndice(0);
    setLinhaCabecalho(cabecalho);
    setMapa(sugerirMapeamento(extrairTabela(primeira.matriz, cabecalho).colunas, campos));
    setAvisoModelo("");
  }

  function trocarCabecalho(planilha: number, linha: number) {
    const matriz = planilhas[planilha]?.matriz;
    if (!matriz) return;
    setIndice(planilha);
    setLinhaCabecalho(linha);
    setMapa(sugerirMapeamento(extrairTabela(matriz, linha).colunas, campos));
    setAvisoModelo("");
  }

  function usarModelo(id: string) {
    const salvo = modelosDoTipo.find((m) => m.id === id);
    const modelo = salvo ? lerModelo(salvo.mapeamento) : null;
    const matriz = planilhas[indice]?.matriz;
    if (!modelo || !matriz) return;
    const t = extrairTabela(matriz, modelo.linhaCabecalho);
    const r = reaproveitarModelo(modelo, t.colunas);
    setLinhaCabecalho(modelo.linhaCabecalho);
    setMapa(r.colunas);
    setNomeModelo(salvo?.nome ?? "");
    setAvisoModelo(r.ausentes.length ? `O modelo esperava colunas que não existem neste arquivo: ${r.ausentes.join(", ")}.` : "");
  }

  function executar(acao: () => Promise<{ ok: true } | { ok: false; erro: string }>, sucesso: string) {
    iniciar(async () => {
      const r = await acao();
      if (r.ok) toast.success(sucesso);
      else toast.error(r.erro);
    });
  }

  const modeloAtual = () => criarModelo(mapa, linhaCabecalho);

  if (modulos.length === 0) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Você não tem acesso de operador em nenhum módulo ativo.</p>;
  }

  return (
    <div className="space-y-4">
      <Secao numero={1} titulo="O que será importado">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium">
            Módulo
            <select value={modulo} onChange={(e) => setModulo(e.target.value)} className={selecao}>
              {modulos.map((m) => <option key={m.codigo} value={m.codigo}>{m.nome}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Tipo da importação
            <Input value={tipo} onChange={(e) => setTipo(e.target.value.toLowerCase())} placeholder="titulos_abertos" />
            <span className="text-xs font-normal text-muted-foreground">Letras minúsculas, números e _. Os modelos salvos são por módulo + tipo.</span>
          </label>
        </div>
        <label className="grid gap-1.5 text-sm font-medium">
          Campos de destino
          <Textarea value={camposTexto} onChange={(e) => setCamposTexto(e.target.value)} rows={5} placeholder={"Um por linha. Termine com * se for obrigatório.\nDocumento*\nParcela\nCliente\nVencimento*\nValor*"} />
          <span className="text-xs font-normal text-muted-foreground">
            Nesta fase os campos são livres, só para testar o mapeamento. Quando um módulo usar o importador, ele traz os próprios campos.
          </span>
        </label>
      </Secao>

      <Secao numero={2} titulo="Arquivo">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1.5 text-sm font-medium">
            CSV ou XLSX (até {TAMANHO_MAXIMO_IMPORTACAO / 1024 / 1024} MB)
            <input
              type="file"
              accept=".csv,.txt,.xlsx"
              className="text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setArquivo(f);
                if (f) void carregar(f, delimitador);
              }}
            />
          </label>
          {arquivo?.name.toLowerCase().match(/\.(csv|txt)$/) && (
            <label className="grid gap-1.5 text-sm font-medium">
              Separador
              <select value={delimitador} onChange={(e) => { setDelimitador(e.target.value); if (arquivo) void carregar(arquivo, e.target.value); }} className={selecao}>
                <option value="">Detectar</option>
                <option value=";">Ponto e vírgula ( ; )</option>
                <option value=",">Vírgula ( , )</option>
                <option value={"\t"}>Tabulação</option>
                <option value="|">Barra vertical ( | )</option>
              </select>
            </label>
          )}
          {planilhas.length > 1 && (
            <label className="grid gap-1.5 text-sm font-medium">
              Planilha
              <select value={indice} onChange={(e) => trocarCabecalho(Number(e.target.value), detectarLinhaCabecalho(planilhas[Number(e.target.value)].matriz))} className={selecao}>
                {planilhas.map((p, i) => <option key={p.nome} value={i}>{p.nome}</option>)}
              </select>
            </label>
          )}
          {tabela && (
            <label className="grid gap-1.5 text-sm font-medium">
              Linha do cabeçalho
              <Input
                type="number" min={1} max={planilhas[indice].matriz.length} className="w-24"
                value={linhaCabecalho + 1}
                onChange={(e) => trocarCabecalho(indice, Math.max(0, Math.min(planilhas[indice].matriz.length - 1, Number(e.target.value) - 1)))}
              />
            </label>
          )}
        </div>
        {lendo && <p className="text-sm text-muted-foreground">Lendo o arquivo…</p>}
        {erroLeitura && <p role="alert" className="text-sm text-destructive">{erroLeitura}</p>}
        {tabela && <p className="text-sm text-muted-foreground"><FileSpreadsheet className="mr-1 inline size-4" />{tabela.linhas.length} linhas de dados, {tabela.colunas.length} colunas (cabeçalho na linha {linhaCabecalho + 1}).</p>}
      </Secao>

      {tabela && (
        <>
          <Secao numero={3} titulo="Mapeamento de colunas">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={campos.length === 0} onClick={() => { setMapa(sugerirMapeamento(tabela.colunas, campos)); setAvisoModelo(""); }}>
                <Sparkles /> Sugerir pelo nome das colunas
              </Button>
              {modelosDoTipo.length > 0 && (
                <select aria-label="Usar modelo salvo" defaultValue="" onChange={(e) => e.target.value && usarModelo(e.target.value)} className={selecao}>
                  <option value="">Usar modelo salvo…</option>
                  {modelosDoTipo.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
              )}
            </div>
            {avisoModelo && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{avisoModelo}</p>}
            {campos.length === 0 && <p className="text-sm text-muted-foreground">Informe os campos de destino no passo 1 para poder mapear.</p>}

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr><th className="px-3 py-2 font-medium">Coluna do arquivo</th><th className="px-3 py-2 font-medium">Exemplos</th><th className="px-3 py-2 font-medium">Campo de destino</th></tr>
                </thead>
                <tbody>
                  {tabela.colunas.map((coluna, i) => (
                    <tr key={coluna} className="border-t">
                      <td className="px-3 py-2 font-medium">{coluna}</td>
                      <td className="max-w-64 truncate px-3 py-2 text-muted-foreground">{tabela.linhas.slice(0, 3).map((l) => l[i]).filter(Boolean).join(" · ") || "—"}</td>
                      <td className="px-3 py-2">
                        <select
                          aria-label={`Campo de destino da coluna ${coluna}`}
                          value={mapa[coluna] ?? ""}
                          onChange={(e) => setMapa((atual) => {
                            const novo = { ...atual };
                            if (e.target.value) novo[coluna] = e.target.value; else delete novo[coluna];
                            return novo;
                          })}
                          className={selecao}
                        >
                          <option value="">— ignorar —</option>
                          {campos.map((c) => <option key={c.chave} value={c.chave}>{c.rotulo}{c.obrigatorio ? " *" : ""}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {problemas.length > 0 && (
              <ul role="alert" className="list-disc space-y-0.5 pl-5 text-sm text-destructive">
                {problemas.map((p) => <li key={p.tipo + p.campo}>{p.mensagem}</li>)}
              </ul>
            )}
          </Secao>

          <Secao numero={4} titulo="Conferência">
            {camposMapeados.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ligue ao menos uma coluna a um campo para ver a prévia.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left"><tr>{camposMapeados.map((c) => <th key={c.chave} className="px-3 py-2 font-medium">{c.rotulo}</th>)}</tr></thead>
                  <tbody>
                    {previa.map((linha, i) => (
                      <tr key={i} className="border-t">{camposMapeados.map((c) => <td key={c.chave} className="px-3 py-2">{linha[c.chave] || "—"}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Valores aparecem como vieram no arquivo. A conversão de datas e valores é regra de cada módulo.</p>
          </Secao>

          <Secao numero={5} titulo="Salvar">
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1.5 text-sm font-medium">
                Nome do modelo
                <Input value={nomeModelo} onChange={(e) => setNomeModelo(e.target.value)} placeholder="Consistem padrão" className="w-64" />
              </label>
              <Button type="button" variant="outline" disabled={!pronto || nomeModelo.trim().length < 2 || pendente}
                onClick={() => executar(() => salvarModeloImportacao({ modulo, tipo: tipo.trim(), nome: nomeModelo.trim(), modelo: modeloAtual() }), "Modelo salvo.")}>
                <Save /> Salvar modelo
              </Button>
              <Button type="button" disabled={!pronto || !arquivo || pendente}
                onClick={() => executar(() => registrarImportacao({ modulo, tipo: tipo.trim(), arquivo: arquivo?.name ?? "", modelo: modeloAtual() }), "Importação registrada.")}>
                Registrar importação
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Nesta fase nada é gravado nas tabelas dos módulos: só o modelo de mapeamento e o registro da importação, com a cópia do mapeamento usado.</p>
          </Secao>
        </>
      )}
    </div>
  );
}
