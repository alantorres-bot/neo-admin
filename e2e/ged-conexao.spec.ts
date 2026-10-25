// Configurações > Google Drive (GED) no navegador, contra o Supabase SIMULADO (playwright.ged.config.ts). O app roda de verdade
// (proxy, sessão, exigirAdminGeral, ações de servidor); auth, banco e Edge Function são respostas de teste. Qualquer pedido do
// navegador para fora de 127.0.0.1 é bloqueado e reprova o teste: nada vai ao Google nem à produção.
// GED_E2E_CAPTURAS=<pasta> salva capturas de tela para revisão visual.
import { expect, test, type Page } from "@playwright/test";

const SUPABASE = "http://127.0.0.1:54399";
const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const COMUM = "00000000-0000-4000-8000-0000000000b2";
const ROTA = "/configuracoes/documentos";
const CONECTADA = {
  email: "ged.drive@exemplo.invalid", escopos: ["openid", "https://www.googleapis.com/auth/drive.readonly"],
  conectado_em: "2026-10-24T15:00:00Z", desconectado_em: null, revogacao_remota: null, ultimo_erro: null, ultimo_erro_em: null,
  situacao: "conectada",
};

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** Sessão de teste no cookie do @supabase/ssr (token HS256 fictício: o app o confere no /auth/v1/user simulado). */
function cookieDeSessao(usuario: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({
    sub: usuario, exp, aud: "authenticated", role: "authenticated", amr: [{ method: "oauth", timestamp: exp - 60 }],
  })}.assinatura-ficticia`;
  const sessao = { access_token: token, refresh_token: "refresh-ficticio", token_type: "bearer", expires_in: 3600, expires_at: exp, user: { id: usuario } };
  return { name: "sb-127-auth-token", value: `base64-${b64url(sessao)}`, domain: "127.0.0.1", path: "/" };
}

async function cenario(page: Page, c: Record<string, unknown>) {
  const r = await page.request.post(`${SUPABASE}/__cenario`, { data: c });
  expect(r.ok()).toBeTruthy();
}
const chamadas = async (page: Page) => (await (await page.request.get(`${SUPABASE}/__chamadas`)).json()) as { metodo: string; caminho: string; busca: string; autorizacao: string | null; corpo: string }[];

async function capturar(page: Page, nome: string) {
  const pasta = process.env.GED_E2E_CAPTURAS;
  if (pasta) await page.screenshot({ path: `${pasta}/${nome}.png`, fullPage: true });
}

const externos: string[] = [];
test.beforeEach(async ({ context }) => {
  externos.length = 0;
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (rota) => {
    externos.push(rota.request().url());
    return rota.abort();
  });
});
test.afterEach(() => expect(externos, "pedido para fora da máquina").toEqual([]));

async function entrar(page: Page, usuario = ADMIN) {
  await page.context().addCookies([cookieDeSessao(usuario)]);
}
const cartao = (page: Page) => page.locator("[data-slot=card]").filter({ hasText: "Google Drive" });

test("1. admin geral abre a tela pela aba de Configurações", async ({ page }) => {
  await cenario(page, {});
  await entrar(page);
  await page.goto("/configuracoes/empresas");
  await page.getByRole("link", { name: "Google Drive (GED)" }).click();
  await expect(page).toHaveURL(new RegExp(`${ROTA}$`), { timeout: 60_000 }); // 1º acesso compila a rota no next dev
  await expect(cartao(page).getByText("Desconectado")).toBeVisible();
  await capturar(page, "01-desconectado");
});

test("2. usuário sem admin geral não vê a aba nem abre a tela", async ({ page }) => {
  await cenario(page, { usuario: COMUM });
  await entrar(page, COMUM);
  await page.goto("/configuracoes/empresas");
  await expect(page.getByRole("link", { name: "Aplicativos" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Google Drive (GED)" })).toHaveCount(0);
  await page.goto(ROTA);
  await expect(page).toHaveURL(/\/inicio/);
  expect((await chamadas(page)).some((c) => c.caminho.endsWith("/ged_situacao_conexao"))).toBe(false);
});

test("3 e 4. desconectado: com conta, botão habilitado; sem conta, desabilitado com aviso", async ({ page }) => {
  await cenario(page, {});
  await entrar(page);
  await page.goto(ROTA);
  await expect(page.getByRole("button", { name: "Conectar Google Drive" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Desconectar" })).toHaveCount(0);

  await cenario(page, { conta: null });
  await page.reload();
  await expect(page.getByRole("button", { name: "Conectar Google Drive" })).toBeDisabled();
  await expect(page.getByText(/configure a conta dedicada do GED/)).toBeVisible();
  await capturar(page, "04-sem-conta");
});

test("3b. conta dedicada: admin grava pela tela, validada e sem troca com conexão ativa", async ({ page }) => {
  await cenario(page, { conta: null });
  await entrar(page);
  await page.goto(ROTA);
  const campo = page.getByLabel("Conta dedicada do GED");
  await campo.fill("ged@gmail.com");
  await page.getByRole("button", { name: "Salvar conta" }).click();
  await expect(page.getByText("Use um e-mail @neoformas.com.br válido.")).toBeVisible();
  expect((await chamadas(page)).filter((c) => c.metodo === "PATCH")).toEqual([]);

  await campo.fill(" Teste.Ficticio.GED@NeoFormas.com.br ");
  await page.getByRole("button", { name: "Salvar conta" }).click();
  await expect(page.getByText("Conta do GED salva.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Conectar Google Drive" })).toBeEnabled();
  const gravacoes = (await chamadas(page)).filter((c) => c.metodo === "PATCH");
  expect(gravacoes).toHaveLength(1);
  expect(JSON.parse(gravacoes[0].corpo)).toEqual({ valor: "teste.ficticio.ged@neoformas.com.br" });
  await capturar(page, "03b-conta-salva");

  await cenario(page, { situacao: CONECTADA });
  await page.reload();
  await expect(page.getByLabel("Conta dedicada do GED")).toHaveCount(0);
});

test("5. conectado: conta, somente leitura, data e Desconectar; nada sensível na página", async ({ page }) => {
  await cenario(page, { situacao: CONECTADA });
  await entrar(page);
  await page.goto(ROTA);
  const c = cartao(page);
  await expect(c.getByText("Conectado", { exact: true })).toBeVisible();
  await expect(c.getByText("ged.drive@exemplo.invalid")).toBeVisible();
  await expect(c.getByText("Somente leitura do Drive")).toBeVisible();
  await expect(c.getByRole("button", { name: "Desconectar" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Conectar Google Drive/ })).toHaveCount(0);
  const html = await page.content();
  for (const s of ["segredo_id", "google_sub", "refresh", "code_verifier", "access_token"]) expect(html).not.toContain(s);
  await capturar(page, "05-conectado");
});

test("6. com erro: mensagem por código, Reconectar leva ao fluxo existente e volta conectado", async ({ page }) => {
  await cenario(page, { situacao: { ...CONECTADA, situacao: "com_erro", ultimo_erro: "invalid_grant", ultimo_erro_em: "2026-10-24T16:00:00Z" } });
  await entrar(page);
  await page.goto(ROTA);
  await expect(cartao(page).getByText("Com erro")).toBeVisible();
  await expect(page.getByText(/deixou de valer/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Desconectar" })).toBeEnabled();
  await capturar(page, "06-com-erro");

  await page.getByRole("button", { name: "Reconectar Google Drive" }).click();
  await expect(page.getByText("Google Drive conectado.")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${ROTA}$`)); // URL limpa
  await expect(cartao(page).getByText("Conectado", { exact: true })).toBeVisible();
  const lista = await chamadas(page);
  expect(lista.find((c) => c.caminho.endsWith("/ged_iniciar_conexao"))).toBeTruthy();
  expect(lista.find((c) => c.metodo === "GET" && c.caminho === "/functions/v1/nucleo-ged-conectar")).toBeTruthy();
});

test("7. retorno do OAuth: sucesso, recusa e erro genérico, com a URL limpa", async ({ page }) => {
  await cenario(page, {});
  await entrar(page);
  const casos: [string, RegExp][] = [
    ["?ged=conectado", /Google Drive conectado\./],
    ["?ged=recusado&codigo=recusado", /A autorização foi recusada no Google\./],
    ["?ged=erro&codigo=conta_divergente", /não é a conta configurada/],
    ["?ged=erro&codigo=qualquer-coisa", /Não foi possível conectar o Google Drive\./],
  ];
  for (const [busca, texto] of casos) {
    await page.goto(ROTA + busca);
    await expect(page.getByText(texto)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${ROTA}$`));
  }
});

test("8. parâmetros maliciosos no retorno não são interpretados nem exibidos", async ({ page }) => {
  await cenario(page, {});
  await entrar(page);
  const ataque = `<img src=x onerror="window.__xss=1">`;
  await page.goto(`${ROTA}?ged=erro&codigo=${encodeURIComponent(ataque)}`);
  await expect(page.getByText("Não foi possível conectar o Google Drive.")).toBeVisible();
  // O texto do ataque só pode existir codificado em URL (endereços e dados internos do Next), nunca como HTML ou texto visível.
  const injecao = () =>
    page.evaluate(() => {
      const corpo = document.body.cloneNode(true) as HTMLElement;
      corpo.querySelectorAll("script").forEach((s) => s.remove());
      return {
        executou: (window as unknown as { __xss?: number }).__xss !== undefined,
        elementosComOnerror: document.querySelectorAll("[onerror]").length,
        imgInjetada: /<img[^>]*src="?x/i.test(corpo.innerHTML),
        visivel: /onerror|<img/i.test(document.body.innerText),
      };
    });
  expect(await injecao()).toEqual({ executou: false, elementosComOnerror: 0, imgInjetada: false, visivel: false });
  await page.goto(`${ROTA}?ged=${encodeURIComponent(ataque)}`);
  expect(await injecao()).toEqual({ executou: false, elementosComOnerror: 0, imgInjetada: false, visivel: false });
});

test("9. desconectar: pede confirmação, ignora clique duplo e atualiza o estado", async ({ page }) => {
  await cenario(page, { situacao: CONECTADA, desconectarAtrasoMs: 1500, revogacao: "ok" });
  await entrar(page);
  await page.goto(ROTA);
  await page.getByRole("button", { name: "Desconectar" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByText("Desconectar o Google Drive?")).toBeVisible();
  await expect(dialogo.getByText(/também será revogado no Google/)).toBeVisible();
  await capturar(page, "09-confirmacao");
  await dialogo.getByRole("button", { name: "Voltar" }).click();
  await expect(dialogo).toHaveCount(0);
  const desconexoes = async () => (await chamadas(page)).filter((c) => c.metodo === "POST" && c.caminho === "/functions/v1/nucleo-ged-conectar");
  expect(await desconexoes()).toHaveLength(0); // voltar não desconecta

  await page.getByRole("button", { name: "Desconectar" }).click();
  const confirmar = page.getByRole("dialog").getByRole("button", { name: "Confirmar desconexão" });
  await confirmar.dblclick();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Desconectando…" })).toBeDisabled();
  await expect(page.getByText("Google Drive desconectado e acesso revogado no Google.")).toBeVisible();
  await expect(cartao(page).getByText("Desconectado")).toBeVisible();
  const posts = await desconexoes();
  expect(posts).toHaveLength(1);
  expect(posts[0].autorizacao).toBe("Bearer …"); // o JWT do admin vai à Edge Function
});

test("10. falhas do banco e da Edge Function viram mensagens seguras", async ({ page }) => {
  await entrar(page);
  await cenario(page, { iniciarErro: { code: "PGRST202", message: "Could not find the function public.ged_iniciar_conexao" } });
  await page.goto(ROTA);
  await page.getByRole("button", { name: "Conectar Google Drive" }).click();
  await expect(page.getByText("Não foi possível iniciar a conexão. Tente de novo.")).toBeVisible();
  await expect(page.getByText(/Could not find|PGRST/)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${ROTA}$`));

  await cenario(page, { situacao: CONECTADA, desconectarErro: true });
  await page.reload();
  await page.getByRole("button", { name: "Desconectar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar desconexão" }).click();
  await expect(page.getByText("Não foi possível desconectar agora. Tente de novo.")).toBeVisible();
  await expect(cartao(page).getByText("Conectado", { exact: true })).toBeVisible(); // estado não fica inconsistente
  await expect(page.getByRole("button", { name: "Desconectar" })).toBeEnabled();

  await cenario(page, { semMigration: true });
  await page.reload();
  await expect(page.getByText(/ainda não está disponível neste ambiente/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Conectar|Desconectar/ })).toHaveCount(0);
  await capturar(page, "10-sem-migration");
});

test("tela estreita (celular): sem rolagem horizontal e botões visíveis", async ({ page }) => {
  await cenario(page, { situacao: CONECTADA });
  await entrar(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(ROTA);
  await expect(page.getByRole("button", { name: "Desconectar" })).toBeVisible();
  const larguras = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, janela: window.innerWidth }));
  expect(larguras.doc).toBeLessThanOrEqual(larguras.janela);
  await capturar(page, "11-celular");
});

test("12. pastas-raiz: cadastra o dossiê com áreas explícitas, ativa só depois da verificação e inativa", async ({ page }) => {
  await cenario(page, { situacao: CONECTADA });
  await entrar(page);
  await page.goto(ROTA);
  const raizes = page.locator("[data-slot=card]").filter({ hasText: "Pastas-raiz do GED" });
  const dossie = raizes.getByRole("row").filter({ hasText: "01 - CLIENTES" });
  await expect(raizes.getByRole("row").filter({ hasText: "02 - CONTRATOS" })).toContainText("Não cadastrada");
  await expect(raizes).not.toContainText("(alternativa)");

  // Cadastro: nenhuma área vem marcada; o botão só libera com dona e operação escolhidas.
  await dossie.getByRole("button", { name: "Cadastrar" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByRole("button", { name: "Cadastrar" })).toBeDisabled();
  await expect(dialogo.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await dialogo.getByLabel("Área dona (lê)").selectOption("contratos");
  await dialogo.getByLabel("Área de operação (classifica e vincula)").selectOption("contratos");
  await dialogo.getByRole("checkbox", { name: "Comercial" }).click();
  await dialogo.getByRole("button", { name: "Cadastrar" }).click();
  await expect(dossie).toContainText("01 - CLIENTES (ficticio)");
  await expect(dossie).toContainText("Em verificação");
  await expect(dossie).toContainText("Leitura: Comercial");
  const cadastro = (await chamadas(page)).find((c) => c.caminho === "/functions/v1/nucleo-ged-metadados");
  expect(JSON.parse(cadastro?.corpo ?? "{}")).toEqual({
    acao: "cadastrar_raiz", raiz: "1-mAz3tuBGa2-sMGCIWoo3jR2RlZ9lNak", area: "contratos", areas_leitura: ["comercial"], area_operacao: "contratos",
  });

  // Ativar antes de verificar: recusado pelo banco, com mensagem clara.
  await dossie.getByRole("button", { name: "Ativar" }).click();
  await expect(page.getByText(/não foi completa/)).toBeVisible();
  await expect(dossie).toContainText("Em verificação");

  // Verifica (seção acima) e ativa; depois inativa.
  await page.locator("div.rounded-md.border").filter({ hasText: "Dossiê: 02 - COMERCIAL / 01 - CLIENTES" }).getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByText("3 itens lidos")).toBeVisible();
  await dossie.getByRole("button", { name: "Ativar" }).click();
  await expect(dossie).toContainText("Ativa");
  await dossie.getByRole("button", { name: "Inativar" }).click();
  await expect(dossie).toContainText("Inativa");
  await capturar(page, "12-pastas-raiz");
});

test("13. pastas-raiz: elaboração cadastra com áreas fixas e não tem botão de áreas", async ({ page }) => {
  await cenario(page, { situacao: CONECTADA });
  await entrar(page);
  await page.goto(ROTA);
  const elaboracao = page.locator("[data-slot=card]").filter({ hasText: "Pastas-raiz do GED" }).getByRole("row").filter({ hasText: "02 - CONTRATOS" });
  await elaboracao.getByRole("button", { name: "Cadastrar" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toContainText("sem outras áreas de leitura (fixo)");
  await expect(dialogo.locator("select")).toHaveCount(0);
  await dialogo.getByRole("button", { name: "Cadastrar" }).click();
  await expect(elaboracao).toContainText("Dona: Contratos · Operação: Contratos");
  await expect(elaboracao.getByRole("button", { name: "Áreas" })).toHaveCount(0);
  const cadastro = (await chamadas(page)).find((c) => c.caminho === "/functions/v1/nucleo-ged-metadados");
  expect(JSON.parse(cadastro?.corpo ?? "{}")).toMatchObject({ area: "contratos", areas_leitura: [], area_operacao: "contratos" });
});

const RAIZES_ATIVAS = [
  { id: "raiz-e", nome: "02 - CONTRATOS", finalidade: "elaboracao", area: "contratos", areas_leitura: [], area_operacao: "contratos", situacao: "ativa" },
  { id: "raiz-d", nome: "01 - CLIENTES", finalidade: "dossie_cliente", area: "contratos", areas_leitura: ["comercial"], area_operacao: "contratos", situacao: "ativa" },
];
const doc = (id: string, nome: string, raiz: string, o: Record<string, unknown> = {}) => ({
  id, nome, nome_normalizado: nome.toLowerCase(), raiz_id: raiz, extensao: "pdf", situacao: "vigente", alterado_no_drive_em: "2026-10-20T12:00:00.000Z",
  web_link: `https://drive.google.com/file/d/${id}/view`, pasta: { nome: "Pasta ficticia" }, ...o,
});
const DOCUMENTOS = [
  doc("d1", "229 - contrato ficticio.docx", "raiz-e"),
  doc("d2", "229 - contrato ficticio.docx", "raiz-d"),
  doc("d3", "229 - temporario.tmp", "raiz-e", { situacao: "ignorado" }),
  doc("d4", "229 - link estranho.pdf", "raiz-d", { web_link: "javascript:alert(1)" }),
];

test("14. Central de Documentos: busca, filtro por finalidade, mesmo nome nas duas pastas e Abrir no Drive", async ({ page }) => {
  await cenario(page, { raizes: RAIZES_ATIVAS, documentos: DOCUMENTOS });
  await entrar(page);
  await page.goto("/documentos?q=229");
  await expect(page.getByRole("heading", { name: "Central de Documentos" })).toBeVisible({ timeout: 60_000 });
  const linhas = page.getByRole("row").filter({ hasText: "229" });
  await expect(linhas).toHaveCount(3);                                         // o temporário (ignorado) não aparece
  await expect(page.getByText("Mesmo nome na outra pasta")).toHaveCount(2);
  const abrir = linhas.filter({ hasText: "Elaboração" }).getByRole("link", { name: /Abrir no Drive/ });
  await expect(abrir).toHaveAttribute("href", "https://drive.google.com/file/d/d1/view");
  await expect(abrir).toHaveAttribute("rel", "noopener noreferrer");
  await expect(linhas.filter({ hasText: "link estranho" }).getByRole("link")).toHaveCount(0);
  await expect(page.locator('a[href^="javascript"]')).toHaveCount(0);

  await page.getByLabel("Finalidade").selectOption("elaboracao");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/finalidade=elaboracao/);
  await expect(page.getByRole("row").filter({ hasText: "229" })).toHaveCount(1);
  const busca = (await chamadas(page)).filter((c) => c.caminho === "/rest/v1/ged_documentos").at(-1);
  expect(busca?.busca).toContain("raiz_id=in.%28raiz-e%29");
  await capturar(page, "14-documentos");
});

test("15. Central de Documentos: sem pasta liberada, só o aviso fixo e nenhuma busca", async ({ page }) => {
  await cenario(page, { raizes: [], documentos: DOCUMENTOS });
  await entrar(page, COMUM);
  await page.goto("/documentos?q=229");
  await expect(page.getByText("Você não tem acesso a nenhuma pasta do GED")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("textbox")).toHaveCount(0);
  expect((await chamadas(page)).some((c) => c.caminho === "/rest/v1/ged_documentos")).toBe(false);
});
