import { describe, expect, it } from "vitest";
import {
  criarTrava,
  descreverSituacao,
  lerRetornoGed,
  mensagemDesconexao,
  mensagemErroInicio,
  urlInicioConexaoGed,
  validarContaGed,
  type SituacaoConexaoGed,
} from "./conexao-tela";

const base: SituacaoConexaoGed = {
  email: "ged.drive@exemplo.invalid", escopos: ["openid", "https://www.googleapis.com/auth/drive.readonly"], conectado_em: "2026-10-24T12:00:00Z",
  desconectado_em: null, revogacao_remota: null, ultimo_erro: null, ultimo_erro_em: null, situacao: "conectada",
};

describe("retorno do OAuth", () => {
  it("sucesso, recusa e erros por código fixo", () => {
    expect(lerRetornoGed("conectado", null)).toEqual({ tipo: "sucesso", mensagem: "Google Drive conectado." });
    expect(lerRetornoGed("recusado", "recusado")).toMatchObject({ tipo: "erro", mensagem: expect.stringContaining("recusada") });
    expect(lerRetornoGed("erro", "conta_divergente")?.mensagem).toContain("não é a conta configurada");
    expect(lerRetornoGed("erro", "escopo_divergente")?.mensagem).toContain("somente leitura");
  });

  it("texto arbitrário na URL nunca é exibido (código desconhecido ou injetado vira mensagem genérica)", () => {
    for (const lixo of ["<script>alert(1)</script>", "fulano@exemplo.invalid", "constructor", "__proto__", "toString", ""]) {
      expect(lerRetornoGed("erro", lixo)).toEqual({ tipo: "erro", mensagem: "Não foi possível conectar o Google Drive." });
    }
    expect(lerRetornoGed("qualquer", "recusado")).toBeNull();
    expect(lerRetornoGed(null, null)).toBeNull();
  });
});

describe("situação", () => {
  it("três estados", () => {
    expect(descreverSituacao(null)).toMatchObject({ estado: "desconectada", rotulo: "Desconectado", detalhe: null });
    expect(descreverSituacao(base)).toMatchObject({ estado: "conectada", rotulo: "Conectado" });
    expect(descreverSituacao({ ...base, situacao: "com_erro", ultimo_erro: "invalid_grant" })).toMatchObject({
      estado: "com_erro", detalhe: expect.stringContaining("deixou de valer"),
    });
  });
  it("desconectada com revogação remota que falhou avisa para revogar manualmente", () => {
    expect(descreverSituacao({ ...base, situacao: "desconectada", revogacao_remota: "falhou" }).detalhe).toContain("myaccount.google.com");
  });
});

describe("trava contra ação duplicada", () => {
  it("segundo clique enquanto a primeira ação roda é ignorado; depois, libera (inclusive após erro)", async () => {
    const executar = criarTrava();
    let liberar!: () => void;
    let chamadas = 0;
    const lenta = () => new Promise<void>((r) => { chamadas++; liberar = r; });
    const primeira = executar(lenta);
    expect(await executar(lenta)).toBe(false);
    expect(chamadas).toBe(1);
    liberar();
    expect(await primeira).toBe(true);
    await expect(executar(async () => { throw new Error("falha"); })).rejects.toThrow("falha");
    expect(await executar(async () => {})).toBe(true);
  });
});

describe("início e desconexão", () => {
  it("URL de início só com state de 64 hex e base válida", () => {
    const s = "f".repeat(64);
    expect(urlInicioConexaoGed("https://x.supabase.co/", s)).toBe(`https://x.supabase.co/functions/v1/nucleo-ged-conectar?state=${s}`);
    expect(urlInicioConexaoGed("https://x.supabase.co", "abc")).toBeNull();
    expect(urlInicioConexaoGed("https://x.supabase.co", { s })).toBeNull();
    expect(urlInicioConexaoGed(undefined, s)).toBeNull();
    expect(urlInicioConexaoGed("https://x.supabase.co/caminho", s)).toBeNull();
  });
  it("erro ao iniciar: mensagem nossa (P0001) passa; códigos internos e erros técnicos viram genéricos", () => {
    expect(mensagemErroInicio({ code: "P0001", message: "Só o administrador geral conecta o Drive do GED." })).toContain("administrador geral");
    expect(mensagemErroInicio({ code: "P0001", message: "ged:sem_permissao" })).toBe("Não foi possível iniciar a conexão. Tente de novo.");
    expect(mensagemErroInicio({ code: "PGRST202", message: "Could not find the function public.ged_iniciar_conexao" })).toBe(
      "Não foi possível iniciar a conexão. Tente de novo.",
    );
  });
  it("mensagem da desconexão conforme a revogação", () => {
    expect(mensagemDesconexao("ok").tipo).toBe("sucesso");
    expect(mensagemDesconexao("falhou")).toMatchObject({ tipo: "aviso", mensagem: expect.stringContaining("manualmente") });
    expect(mensagemDesconexao("nao_tentada").mensagem).toContain("não foi feita");
    expect(mensagemDesconexao(undefined).mensagem).toContain("não foi feita");
  });
});

describe("conta dedicada (administrativo.ged.conta)", () => {
  it("normaliza como o banco compara (minúsculas, sem espaços)", () => {
    expect(validarContaGed("  Teste.Ficticio.GED@NeoFormas.com.br ")).toEqual({ ok: true, conta: "teste.ficticio.ged@neoformas.com.br" });
  });
  it("recusa vazio, outro domínio, domínio parecido e texto que não é e-mail", () => {
    for (const t of ["", "   ", null, 42, "ged@gmail.com", "ged@neoformas.com.br.evil.invalid", "ged@sub.neoformas.com.br",
      "a b@neoformas.com.br", "<x>@neoformas.com.br", "@neoformas.com.br", `${"a".repeat(250)}@neoformas.com.br`]) {
      expect(validarContaGed(t).ok, String(t)).toBe(false);
    }
  });
});
