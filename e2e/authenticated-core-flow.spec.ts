import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { countExactCellMatches } from "../scripts/e2e-runner-helpers.mjs";

test("authenticated achievement, attachment, export, and logout flow", async ({ page }) => {
  const runId = process.env.E2E_RUN_ID;
  const passcode = process.env.E2E_PASSCODE;
  const year = process.env.E2E_YEAR;
  if (!runId || !passcode || !year || !process.env.E2E_BASE_URL) {
    throw new Error("E2E tests must be launched by scripts/run-e2e.mjs");
  }
  const title = `E2E browser achievement ${runId}`;
  await page.goto("/login");
  await page.locator('input[name="passcode"]').fill(passcode);
  await page.getByRole("button", { name: "进入" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/achievements/new");
  await page.locator('input[name="title"]').fill(title);
  await page.locator('select[name="status"]').selectOption("PUBLISHED");
  await page.locator('select[name="perfCategoryId"]').selectOption({ label: `browser-${runId}` });
  await page.locator('input[name="isVerified"]').check();
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  await page.locator('input[name="file"]').setInputFiles({
    name: "e2e-fixture.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("E2E attachment", "utf8"),
  });
  await page.getByRole("button", { name: "上传" }).click();
  await expect(page.getByText("e2e-fixture.txt", { exact: true })).toBeVisible();

  await page.goto(`/achievements?scope=all`);
  const row = page.getByRole("row").filter({ hasText: title });
  await row.getByRole("button", { name: "订正" }).click();
  await row.locator('input[name="year"]').fill(year);
  await row.locator('input[name="isVerified"]').check();
  await row.getByRole("button", { name: "保存" }).click();
  await expect(row).toContainText(year);

  await page.goto("/export");
  const exportForm = page.locator('form[action="/api/export/declaration"]').filter({ has: page.locator('input[name="kind"][value="performance"]') }).filter({ has: page.locator(`input[name="year"][value="${year}"]`) }).first();
  const request = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === "/api/export/declaration");
  const download = page.waitForEvent("download");
  await exportForm.getByRole("button").click();
  await request;
  const workbookDownload = await download;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    (await readFile(await workbookDownload.path())) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const detail = workbook.getWorksheet("明细");
  expect(detail).toBeDefined();
  const rows: unknown[][] = [];
  detail?.eachRow({ includeEmpty: false }, (row) => {
    if (Array.isArray(row.values)) rows.push(row.values);
  });
  expect(countExactCellMatches(rows, title)).toBe(1);

  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/export");
  await expect(page).toHaveURL(/\/login\?from=/);
});
