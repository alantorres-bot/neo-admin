"use client";

// Fornecedor "Outros" (classificação 3) de estabelecimento de cartão: ligar a um fornecedor que já existe no Consistem ou
// cadastrar um novo (nome = descrição do estabelecimento, endereço fixo da configuração). Regras 44 a 49 de
// docs/modulos/financeiro-cartao.md. Usado na aba Estabelecimentos e no diálogo de lançar a compra.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { buscarFornecedores, cadastrarFornecedor, ligarFornecedor } from "./acoes";
import type { ListasConsistem } from "@/lib/modulos/financeiro/cartao/listas";
import type { CadastroOutros } from "./dados";
import { SeletorCategoria, SeletorContaFluxo } from "./listas";

/** Formulário de cadastro (nome, categoria, grupo; endereço fixo só para conferir). */
function FormCadastro({ empresaId, nomeInicial, cadastro, listas, fluxoInicial, estabelecimentoId, aoCadastrar, aoVoltar }: {
  empresaId: string; nomeInicial: string; cadastro: CadastroOutros; listas: ListasConsistem; fluxoInicial: { grupo?: number | null; item?: number | null };
  estabelecimentoId: string | null; aoCadastrar: (cod: number, nome: string) => void; aoVoltar: () => void;
}) {
  const [nome, setNome] = useState(nomeInicial.toUpperCase().slice(0, 60));
  const [categoria, setCategoria] = useState<number | null>(cadastro.codCategoria);
  const [fluxo, setFluxo] = useState<{ grupo: number | null; item: number | null }>({ grupo: fluxoInicial.grupo ?? null, item: fluxoInicial.item ?? null });
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  function enviar() {
    iniciar(async () => {
      const r = await cadastrarFornecedor({ empresaId, nome, categoria: categoria ?? 0, grupo: fluxo.grupo ?? 0, item: fluxo.item ?? 0, estabelecimentoId });
      if (r.ok) { toast.success(r.aviso); aoCadastrar(r.codFornecedor, r.nome); } else setErro(r.erro);
    });
  }
  return (
    <div className="grid gap-3">
      <label className="space-y-1 text-sm">
        <span className="block font-medium">Nome do fornecedor (descrição do estabelecimento)</span>
        <Input value={nome} onChange={(e) => setNome(e.target.value.toUpperCase().slice(0, 60))} maxLength={60} autoComplete="off" />
      </label>
      <label className="space-y-1 text-sm"><span className="block font-medium">Categoria do fornecedor</span>
        <SeletorCategoria categorias={listas.categorias} valor={categoria} aoMudar={setCategoria} /></label>
      <label className="space-y-1 text-sm"><span className="block font-medium">Conta de fluxo de caixa (grupo e item do fornecedor)</span>
        <SeletorContaFluxo contas={listas.contasFluxo} grupo={fluxo.grupo} item={fluxo.item} aoMudar={(grupo, item) => setFluxo({ grupo, item })} /></label>
      <p className="text-xs text-muted-foreground">
        Tipo 3 (Outros), sem CNPJ. Endereço igual para todos: {cadastro.endereco}, {cadastro.numero}, {cadastro.bairro}, {cadastro.cep}, {cadastro.cidade}/{cadastro.estado}.
      </p>
      {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={aoVoltar} disabled={pendente}>Voltar</Button>
        <Button type="button" onClick={enviar} disabled={pendente || nome.trim().length < 2 || !categoria || !fluxo.grupo || !fluxo.item}>{pendente ? "Cadastrando…" : "Cadastrar no Consistem"}</Button>
      </div>
    </div>
  );
}

/** Botão + diálogo de cadastro (usado no diálogo de lançar a compra). */
export function BotaoCadastrarFornecedor({ empresaId, nomeInicial, cadastro, listas, fluxoInicial, aoCadastrar }: {
  empresaId: string; nomeInicial: string; cadastro: CadastroOutros | null; listas: ListasConsistem; fluxoInicial: { grupo?: number | null; item?: number | null };
  aoCadastrar: (cod: number, nome: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  if (!cadastro) return null;
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setAberto(true)}>Cadastrar fornecedor</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v) setAberto(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Cadastrar fornecedor no Consistem</DialogTitle>
              <DialogDescription>Fornecedor “Outros” com o nome do estabelecimento desta compra.</DialogDescription>
            </DialogHeader>
            <FormCadastro empresaId={empresaId} nomeInicial={nomeInicial} cadastro={cadastro} listas={listas} fluxoInicial={fluxoInicial} estabelecimentoId={null}
              aoCadastrar={(cod, nome) => { setAberto(false); aoCadastrar(cod, nome); }} aoVoltar={() => setAberto(false)} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** Aba Estabelecimentos: ligar a um fornecedor que já existe (nome parecido) ou cadastrar um novo. */
export function BotaoLigarOuCadastrar({ estabelecimento, empresaId, cadastro, listas, podeCadastrar }: {
  estabelecimento: { id: string; padrao: string; grupo?: number | null; item?: number | null }; empresaId: string; cadastro: CadastroOutros | null;
  listas: ListasConsistem; podeCadastrar: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [modo, setModo] = useState<"ligar" | "cadastrar">("ligar");
  const [lista, setLista] = useState<{ cod: number; nome: string }[] | null>(null);
  const [termo, setTermo] = useState(estabelecimento.padrao.replace(/[^A-Za-z0-9 ]+/g, " ").trim());
  const [pendente, iniciar] = useTransition();
  const buscar = (t: string) => iniciar(async () => setLista(await buscarFornecedores({ empresaId, termo: t })));
  function abrir() {
    setModo("ligar"); setAberto(true); setLista(null); buscar(termo);
  }
  function ligar(cod: number) {
    iniciar(async () => {
      const r = await ligarFornecedor({ estabelecimentoId: estabelecimento.id, codFornecedor: cod });
      if (r.ok) { toast.success(r.aviso); setAberto(false); router.refresh(); } else toast.error(r.erro);
    });
  }
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={abrir}>Ligar ou cadastrar</Button>
      {aberto && (
        <Dialog open onOpenChange={(v) => { if (!v && !pendente) setAberto(false); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Fornecedor de {estabelecimento.padrao}</DialogTitle>
              <DialogDescription>Ligue a um fornecedor que já existe no Consistem ou cadastre um novo (tipo 3, Outros).</DialogDescription>
            </DialogHeader>
            {modo === "ligar" ? (
              <div className="grid gap-3">
                <div className="flex gap-2">
                  <Input value={termo} onChange={(e) => setTermo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscar(termo); } }} maxLength={60} autoComplete="off" />
                  <Button type="button" variant="outline" onClick={() => buscar(termo)} disabled={pendente || termo.trim().length < 2}>Buscar</Button>
                </div>
                {lista === null ? <p className="text-sm text-muted-foreground">Buscando…</p> : lista.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum fornecedor com esse nome no Consistem.</p>
                ) : (
                  <ul className="max-h-56 overflow-y-auto rounded-[3px] border border-grade text-sm">
                    {lista.map((f) => (
                      <li key={f.cod} className="flex items-center justify-between gap-2 border-b border-grade/60 px-2 py-1 last:border-0">
                        <span>{f.cod} · {f.nome}</span>
                        <Button type="button" size="sm" variant="outline" onClick={() => ligar(f.cod)} disabled={pendente}>Ligar</Button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setAberto(false)} disabled={pendente}>Fechar</Button>
                  {podeCadastrar && cadastro && <Button type="button" onClick={() => setModo("cadastrar")}>Cadastrar novo</Button>}
                </div>
              </div>
            ) : (
              <FormCadastro empresaId={empresaId} nomeInicial={estabelecimento.padrao} cadastro={cadastro!} listas={listas}
                fluxoInicial={{ grupo: estabelecimento.grupo, item: estabelecimento.item }} estabelecimentoId={estabelecimento.id}
                aoCadastrar={() => { setAberto(false); router.refresh(); }} aoVoltar={() => setModo("ligar")} />
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
