// Gestão de Parcelamentos no navegador (playwright.parcelamentos.config.ts), contra o Supabase SIMULADO com banco real em
// memória. Qualquer pedido do navegador para fora de 127.0.0.1 é bloqueado e reprova o teste. PARC_CAPTURAS=<pasta> salva telas.
import { expect, test, type Page } from "@playwright/test";

const SUPABASE = "http://127.0.0.1:54398";
const ROTA = "/financeiro/parcelamentos";
type Papel = "gestor" | "operador" | "consulta" | "semacesso";

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
function cookieDeSessao(usuario: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: usuario, exp, aud: "authenticated", role: "authenticated", amr: [{ method: "oauth", timestamp: exp - 60 }] })}.assinatura-ficticia`;
  const sessao = { access_token: token, refresh_token: "refresh-ficticio", token_type: "bearer", expires_in: 3600, expires_at: exp, user: { id: usuario } };
  return { name: "sb-127-auth-token", value: `base64-${b64url(sessao)}`, domain: "127.0.0.1", path: "/" };
}
let usuarios: Record<Papel, string>;
async function entrar(page: Page, papel: Papel) {
  usuarios ??= await (await page.request.get(`${SUPABASE}/__usuarios`)).json();
  await page.context().clearCookies();
  await page.context().addCookies([cookieDeSessao(usuarios[papel])]);
}
async function capturar(page: Page, nome: string) {
  if (process.env.PARC_CAPTURAS) await page.screenshot({ path: `${process.env.PARC_CAPTURAS}/${nome}.png`, fullPage: true });
}
const grade = (page: Page) => page.locator("table").first();
// abas e filtros são <a> com aparência de botão (o Base UI dá role=button com nativeButton={false})
const aba = (page: Page, texto: string) => page.locator("nav a").filter({ hasText: new RegExp(`^${texto.replace(/[()]/g, "\\$&")}$`) });
/** O texto chega pronto do servidor antes da hidratação: clica até o diálogo abrir. */
async function abrirDialogo(page: Page, botao: ReturnType<Page["getByRole"]>) {
  await expect(async () => {
    await botao.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}

const externos: string[] = [];
test.beforeEach(async ({ context }) => {
  externos.length = 0;
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (rota) => { externos.push(rota.request().url()); return rota.abort(); });
});
test.afterEach(() => expect(externos, "pedido para fora da máquina").toEqual([]));

test("1. gestor: menu, lista de parcelamentos e detalhamento", async ({ page }) => {
  await entrar(page, "gestor");
  await page.goto("/inicio");
  await page.getByRole("link", { name: "Gestão de Parcelamentos" }).first().click();
  await expect(page.getByRole("heading", { name: "Gestão de Parcelamentos" })).toBeVisible({ timeout: 90_000 });
  await expect(grade(page).getByRole("link", { name: "SEFAZ/MT — Parc. ICMS Neo Formas" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Atualizar do Consistem" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Novo parcelamento manual" })).toBeVisible();
  await capturar(page, "01-parcelamentos");

  await grade(page).getByRole("link", { name: "PGE/MT — CDA ICMS 2025658003" }).click();
  await expect(page.getByRole("heading", { name: "PGE/MT — CDA ICMS 2025658003" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Chave no Consistem")).toBeVisible();
  await expect(page.getByText("986:8003")).toBeVisible();
  await expect(page.getByText(/Baixa vista em/).first()).toBeVisible(); // C já pagos (dataPagamento vazia no ERP)
  await expect(page.getByRole("button", { name: "Editar" })).toBeVisible();
  await capturar(page, "02-detalhe-parcelamento");
});

test("2. parcelas e 'sem parcelamento associado'", async ({ page }) => {
  await entrar(page, "gestor");
  await page.goto(`${ROTA}/parcelas`);
  await expect(aba(page, "Todas")).toBeVisible({ timeout: 90_000 });
  await expect(grade(page).getByText("Prefeitura de Cuiabá — ISS (manual, teste)")).toBeVisible();
  await capturar(page, "03-parcelas");
  await aba(page, "Sem parcelamento associado").click();
  await expect(page.getByText(/Lançamentos do Consistem que são parcelamento e ainda não estão numa parcela/)).toBeVisible({ timeout: 60_000 });
  await capturar(page, "04-parcelas-sem-parcelamento");
});

test("3. classificação: sugestões, visões e criar parcelamento pela sugestão", async ({ page }) => {
  await entrar(page, "gestor");
  await page.goto(`${ROTA}/classificacao`);
  const linha = grade(page).getByRole("row").filter({ hasText: "986:4527" });
  await expect(linha).toBeVisible({ timeout: 90_000 });
  await capturar(page, "05-classificacao-sugestoes");

  await abrirDialogo(page, linha.getByRole("button", { name: "Criar parcelamento" }));
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByText(/986:4527/)).toBeVisible();
  await capturar(page, "06-criar-parcelamento-dialogo");
  await dialogo.getByLabel("Descrição").fill("PGE/MT — CDA 2025664527 ICMS (homologação)");
  await dialogo.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText(/Parcelamento criado/)).toBeVisible({ timeout: 30_000 });
  await expect(grade(page).getByRole("row").filter({ hasText: "986:4527" })).toHaveCount(0);

  for (const [visao, arquivo] of [["Sem regra (para análise)", "07-sem-regra"], ["Aguardando conta de fluxo", "08-aguardando"], ["Exceções", "09-excecoes"], ["Pendentes", "10-pendentes"], ["Classificados à mão", "11-manuais"]] as const) {
    await aba(page, visao).click();
    await expect(page).toHaveURL(/ver=/);
    await page.waitForLoadState("networkidle");
    await capturar(page, arquivo);
  }
  await aba(page, "Sem regra (para análise)").click();
  await expect(grade(page).getByText("INSS/IRRF OESTE").first()).toBeVisible({ timeout: 60_000 });
});

test("4. regras e histórico das leituras; operador atualiza do Consistem (simulado)", async ({ page }) => {
  await entrar(page, "gestor");
  await page.goto(`${ROTA}/regras`);
  await expect(page.getByText("Parcelamentos ALUTEC — fornecedor 917")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Qualquer").first()).toBeVisible(); // 917 sem conta de fluxo
  await abrirDialogo(page, page.getByRole("row").filter({ hasText: "Parcelamentos ALUTEC" }).getByRole("button", { name: "Editar" }));
  await expect(page.getByRole("dialog").getByLabel("Fornecedores (códigos)")).toHaveValue("917");
  await expect(page.getByRole("dialog").getByLabel("Grupo de fluxo")).toHaveValue("");
  await capturar(page, "12-editar-regra");
  await page.getByRole("dialog").getByRole("button", { name: "Voltar" }).click();
  await capturar(page, "13-regras-e-leituras");

  await entrar(page, "operador");
  await page.goto(ROTA);
  await expect(page.getByRole("button", { name: "Novo parcelamento manual" })).toHaveCount(0, { timeout: 90_000 });
  await page.getByRole("button", { name: "Atualizar do Consistem" }).click();
  await expect(page.getByText(/Atualizado\. Neo Formas: 0 novo/)).toBeVisible({ timeout: 60_000 });
  await page.goto(`${ROTA}/regras`);
  await expect(page.getByRole("button", { name: "Nova regra" })).toHaveCount(0);
  await expect(page.getByText(/\d+ P e \d+ C no ERP/).first()).toBeVisible({ timeout: 60_000 });
  await capturar(page, "14-leituras-depois-de-atualizar");
});

test("5. consulta só vê; sem acesso ao Financeiro não abre", async ({ page }) => {
  await entrar(page, "consulta");
  await page.goto(ROTA);
  await expect(page.getByRole("heading", { name: "Gestão de Parcelamentos" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("button", { name: "Atualizar do Consistem" })).toHaveCount(0);
  await page.goto(`${ROTA}/classificacao`);
  await expect(page.getByRole("button", { name: "Criar parcelamento" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Juntar a existente" })).toHaveCount(0);
  await capturar(page, "15-consulta-classificacao");

  await entrar(page, "semacesso");
  const r = await page.goto(ROTA);
  expect(r?.status()).toBe(404);
});
