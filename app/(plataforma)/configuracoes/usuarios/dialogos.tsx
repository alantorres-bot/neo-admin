"use client";

import { KeyRound, Pencil, Plus } from "lucide-react";
import { Campo, DialogoFormulario } from "@/components/formularios/dialogo-formulario";
import { Input } from "@/components/ui/input";
import { NIVEIS, ROTULO_NIVEL } from "@/lib/nucleo/permissoes";
import type { Area, NivelAcesso, Perfil } from "@/lib/nucleo/tipos";
import { criarUsuario, redefinirSenha, salvarUsuario } from "./acoes";

export function DialogoNovoUsuario() {
  return (
    <DialogoFormulario
      titulo="Novo usuário"
      descricao="O usuário entra sem nenhuma permissão; libere as áreas depois de criar. Quem tem conta Google da Neo Formas entra com o Google: deixe a senha em branco. Se informar uma senha inicial, avise pessoalmente; no primeiro acesso por senha ele é obrigado a trocá-la."
      botao={<><Plus /> Novo usuário</>}
      variante="default"
      tamanho="default"
      rotuloSalvar="Criar usuário"
      mensagemSucesso="Usuário criado. Agora defina as permissões."
      acao={criarUsuario}
    >
      <Campo id="nome" rotulo="Nome"><Input id="nome" name="nome" required /></Campo>
      <Campo id="email" rotulo="E-mail"><Input id="email" name="email" type="email" autoComplete="off" required /></Campo>
      <Campo id="senha" rotulo="Senha inicial (opcional)" dica="Em branco, a pessoa entra só com o Google. Se preencher, mínimo de 8 caracteres.">
        <Input id="senha" name="senha" type="text" autoComplete="off" minLength={8} />
      </Campo>
    </DialogoFormulario>
  );
}

export function DialogoSenha({ perfil }: { perfil: Perfil }) {
  return (
    <DialogoFormulario
      titulo={`Redefinir senha de ${perfil.nome}`}
      botao={<><KeyRound /> Senha</>}
      variante="ghost"
      rotuloSalvar="Redefinir senha"
      mensagemSucesso="Senha redefinida."
      acao={redefinirSenha}
    >
      <input type="hidden" name="id" value={perfil.id} />
      <Campo id={`senha-${perfil.id}`} rotulo="Nova senha" dica="Mínimo de 8 caracteres. Avise o usuário: no próximo acesso ele terá que trocá-la.">
        <Input id={`senha-${perfil.id}`} name="senha" type="text" autoComplete="off" minLength={8} required />
      </Campo>
    </DialogoFormulario>
  );
}

export function DialogoPermissoes({
  perfil, areas, niveis, ehOProprio,
}: { perfil: Perfil; areas: Area[]; niveis: Record<string, NivelAcesso>; ehOProprio: boolean }) {
  return (
    <DialogoFormulario
      titulo={`Permissões de ${perfil.nome}`}
      descricao={perfil.email}
      botao={<><Pencil /> Permissões</>}
      variante="ghost"
      mensagemSucesso="Permissões salvas."
      acao={salvarUsuario}
    >
      <input type="hidden" name="id" value={perfil.id} />
      <div className="grid gap-2">
        {areas.map((a) => (
          <div key={a.codigo} className="flex items-center justify-between gap-3">
            <label htmlFor={`nivel_${a.codigo}-${perfil.id}`} className="text-sm">
              {a.nome}
              {a.sensivel && <span className="ml-1.5 text-xs text-muted-foreground">(sensível)</span>}
            </label>
            <select
              id={`nivel_${a.codigo}-${perfil.id}`}
              name={`nivel_${a.codigo}`}
              defaultValue={niveis[a.codigo] ?? "sem_acesso"}
              className="h-8 rounded-lg border bg-background px-2 text-sm"
            >
              {NIVEIS.map((n) => <option key={n} value={n}>{ROTULO_NIVEL[n]}</option>)}
            </select>
          </div>
        ))}
      </div>
      <div className="grid gap-2 border-t pt-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="admin_geral" defaultChecked={perfil.admin_geral} disabled={ehOProprio} className="size-4" />
          Administrador geral <span className="text-xs text-muted-foreground">(acesso total a todas as áreas e às configurações)</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="ativo" defaultChecked={perfil.ativo} disabled={ehOProprio} className="size-4" />
          Usuário ativo
        </label>
        <label className="grid gap-1 text-sm">
          <span>
            Restrito à unidade{" "}
            <span className="text-xs text-muted-foreground">(vê só o Faturamento Filial, com o nível do Financeiro; não vale para administrador geral)</span>
          </span>
          <select name="unidade_restrita" defaultValue={perfil.unidade_restrita ?? ""} disabled={ehOProprio} className="h-8 w-56 rounded-lg border bg-background px-2 text-sm">
            <option value="">Sem restrição</option>
            <option value="contagem">Filial Contagem</option>
          </select>
        </label>
        {/* checkbox desabilitado não é enviado: no próprio usuário, reenvia os valores atuais */}
        {ehOProprio && (
          <>
            <input type="hidden" name="admin_geral" value={perfil.admin_geral ? "on" : ""} />
            <input type="hidden" name="ativo" value={perfil.ativo ? "on" : ""} />
          </>
        )}
      </div>
    </DialogoFormulario>
  );
}
