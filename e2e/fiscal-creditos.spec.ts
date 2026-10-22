// Fluxos principais do Fiscal Control pela interface (ver playwright.fiscal.config.ts). Usuários de teste:
// admin, analista, revisor, contador e leitor @neoformas.com.br com a senha de FISCAL_E2E_SENHA.
import { expect, test, type Page } from "@playwright/test";

const SENHA = process.env.FISCAL_E2E_SENHA ?? "Senha-Teste-123";
const ROTA = "/fiscal/creditos";
const sufixo = Date.now().toString().slice(-6);

async function entrar(page: Page, quem: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(`${quem}@neoformas.com.br`);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
const semErroDeTela = async (page: Page) => expect(page.getByText("Não foi possível carregar esta tela")).toHaveCount(0);
async function dialogo(page: Page, botao: string | RegExp) {
  await page.getByRole("button", { name: botao }).first().click();
  return page.getByRole("dialog");
}

test.describe.serial("Fiscal Control", () => {
  test("todas as seções abrem com dados calculados (analista)", async ({ page }) => {
    await entrar(page, "analista");
    for (const [rota, texto] of [
      ["painel", "Créditos registrados"], ["creditos", "Créditos tributários"], ["movimentos", "Livro de movimentações"], ["apuracao", "Apuração"],
      ["consolidado", "Consolidado do exercício"], ["obrigacoes", "Central de obrigações"], ["documentos", "Repositório de documentos"],
      ["conciliacao", "Verificações automáticas"], ["tarefas", "Fila de aprovações"], ["relatorios", "Relatórios"], ["configuracoes", "Estabelecimentos"],
    ] as const) {
      await page.goto(`${ROTA}/${rota}${rota === "painel" || rota === "consolidado" ? "?ano=2025" : ""}`);
      await expect(page.getByText(texto).first()).toBeVisible();
      await semErroDeTela(page);
    }
  });

  test("cria crédito, que nasce indisponível; utilização é barrada até a validação", async ({ page }) => {
    await entrar(page, "analista");
    await page.goto(`${ROTA}/creditos`);
    const d = await dialogo(page, "Novo crédito");
    await d.getByLabel("Estabelecimento *").selectOption({ label: "Matriz Cuiabá (FICTÍCIA)" });
    await d.getByLabel("Tributo *").selectOption({ label: "ICMS — ICMS" });
    await d.getByLabel("Categoria *").selectOption({ label: "Saldo credor de ICMS na apuração · parâmetros não validados" });
    await d.getByLabel("Competência de origem *").fill("2026-09");
    await d.getByLabel("Valor original (R$) *").fill(`1.${sufixo.slice(0, 3)},45`);
    await d.getByLabel("Descrição *").fill(`E2E crédito ${sufixo}`);
    await d.getByRole("button", { name: "Cadastrar" }).click();
    await expect(page.getByText("Crédito cadastrado")).toBeVisible();
    await page.goto(`${ROTA}/creditos?busca=E2E%20cr%C3%A9dito%20${sufixo}`);
    await page.getByRole("link", { name: /^CR-2026-/ }).first().click();
    await page.waitForURL(/creditos\/[0-9a-f-]{36}/);
    await expect(page.getByText("Pendente de validação").filter({ visible: true }).first()).toBeVisible();
    const m = await dialogo(page, "Registrar movimentação");
    await m.getByLabel("Tipo *").selectOption({ value: "utilizacao" });
    await m.getByLabel("Competência *").fill("2026-09");
    await m.getByLabel("Data *").fill("2026-09-30");
    await m.getByLabel("Valor (R$) *").fill("10,00");
    await m.getByLabel("Descrição *").fill("Tentativa antes da validação");
    await m.getByRole("button", { name: "Registrar" }).click();
    await expect(m.getByRole("alert")).toContainText("não está validado");
  });

  test("documento: envio com validação de conteúdo e download por link temporário", async ({ page }) => {
    await entrar(page, "analista");
    await page.goto(`${ROTA}/creditos?busca=E2E%20cr%C3%A9dito%20${sufixo}`);
    await page.getByRole("link", { name: /^CR-2026-/ }).first().click();
    await page.waitForURL(/creditos\/[0-9a-f-]{36}/);
    const d = await dialogo(page, "Anexar documento");
    await d.getByLabel("Arquivo *").setInputFiles({ name: "falso.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ isto não é pdf") });
    await d.getByLabel("Tipo documental *").selectOption({ value: "memoria_calculo" });
    await d.getByRole("button", { name: "Enviar" }).click();
    await expect(d.getByRole("alert")).toContainText("não corresponde");
    await d.getByLabel("Arquivo *").setInputFiles({ name: "memoria.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% memória de cálculo FICTÍCIA\n") });
    await d.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText("Documento enviado")).toBeVisible();
    await expect(page.getByRole("cell", { name: /Documento|memoria/ }).first()).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Baixar" }).first().click()]);
    expect(download.suggestedFilename()).toContain("memoria");
  });

  test("revisor valida; analista utiliza parcialmente; excesso é barrado; painel reflete", async ({ page }) => {
    await entrar(page, "revisor");
    await page.goto(`${ROTA}/creditos?busca=E2E%20cr%C3%A9dito%20${sufixo}`);
    await page.getByRole("link", { name: /^CR-2026-/ }).first().click();
    await page.waitForURL(/creditos\/[0-9a-f-]{36}/);
    const v = await dialogo(page, "Validar / decidir");
    await v.getByRole("button", { name: "Registrar decisão" }).click();
    await expect(page.getByText("Decisão registrada")).toBeVisible();
    await expect(page.locator("span", { hasText: /^✓ Disponível$/ }).first()).toBeVisible();

    await entrar(page, "analista");
    await page.goto(`${ROTA}/painel?ano=2026&mes=9`);
    const antes = await page.getByText("Utilizado em 09/2026").locator("..").innerText();
    await page.goto(`${ROTA}/creditos?busca=E2E%20cr%C3%A9dito%20${sufixo}`);
    await page.getByRole("link", { name: /^CR-2026-/ }).first().click();
    await page.waitForURL(/creditos\/[0-9a-f-]{36}/);
    const preenche = async (valor: string) => {
      const m = await dialogo(page, "Registrar movimentação");
      await m.getByLabel("Tipo *").selectOption({ value: "utilizacao" });
      await m.getByLabel("Competência *").fill("2026-09");
      await m.getByLabel("Data *").fill("2026-09-30");
      await m.getByLabel("Valor (R$) *").fill(valor);
      await m.getByLabel("Descrição *").fill(`Dedução E2E ${valor}`);
      await m.getByRole("button", { name: "Registrar" }).click();
      return m;
    };
    const m1 = await preenche("999.999,00");
    await expect(m1.getByRole("alert")).toContainText("Saldo insuficiente");
    await m1.getByRole("button", { name: "Cancelar" }).click();
    await preenche("100,00");
    await expect(page.getByText("Movimentação registrada")).toBeVisible();
    await page.goto(`${ROTA}/painel?ano=2026&mes=9`);
    const depois = await page.getByText("Utilizado em 09/2026").locator("..").innerText();
    expect(depois).not.toBe(antes);
  });

  test("obrigação: arquivo salvo não vira transmitida; leitor não altera nada", async ({ page }) => {
    await entrar(page, "analista");
    await page.goto(`${ROTA}/obrigacoes?ano=2026&mes=9`);
    await page.getByRole("link", { name: "EFD-Contribuições" }).first().click();
    await page.waitForURL(/obrigacoes\/[0-9a-f-]{36}/);
    await expect(page.getByText("não consta como transmitida")).toBeVisible();
    await expect(page.getByRole("button", { name: "Transmitida (a conferir)" })).toHaveCount(0);

    await entrar(page, "leitor");
    await page.goto(`${ROTA}/creditos`);
    await expect(page.getByRole("button", { name: "Novo crédito" })).toHaveCount(0);
    await page.goto(`${ROTA}/configuracoes`);
    await expect(page.getByText("Somente consulta")).toBeVisible();
  });

  test("competência fechada recusa lançamento; exportação Excel sai com os filtros", async ({ page }) => {
    await entrar(page, "analista");
    await page.goto(`${ROTA}/creditos?busca=ICMS%20da%20matriz`);
    await page.getByRole("link", { name: /^CR-2025-/ }).first().click();
    await page.waitForURL(/creditos\/[0-9a-f-]{36}/);
    const m = await dialogo(page, "Registrar movimentação");
    await m.getByLabel("Tipo *").selectOption({ value: "utilizacao" });
    await m.getByLabel("Competência *").fill("2025-03");
    await m.getByLabel("Data *").fill("2025-03-31");
    await m.getByLabel("Valor (R$) *").fill("1,00");
    await m.getByLabel("Descrição *").fill("Lançamento em competência fechada");
    await m.getByRole("button", { name: "Registrar" }).click();
    await expect(m.getByRole("alert")).toContainText("está fechada");
    const r = await page.request.get(`${ROTA}/relatorios/exportar/consolidado?ano=2025`);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("spreadsheetml");
  });
});
