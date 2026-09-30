import { expect, test } from "@playwright/test";

/**
 * 参赛 →「引用为成果」→ 成果详情能跳回参赛，以及成果页的口径提示。
 *
 * 这两处**只有真机能验**：前者跨三个页面和一个事务（建成果 + 搬证书 + 回填指针），
 * 后者是「默认口径下看不见刚建的东西」这类只在浏览器里才显形的问题。
 */
test("参赛获奖引用为成果后，成果详情能跳回那次参赛", async ({ page }) => {
  const passcode = process.env.E2E_PASSCODE;
  if (!passcode || !process.env.E2E_BASE_URL) {
    throw new Error("E2E tests must be launched by scripts/run-e2e.mjs");
  }

  await page.goto("/login");
  await page.locator('input[name="passcode"]').fill(passcode);
  await page.getByRole("button", { name: "进入" }).click();
  await expect(page).toHaveURL(/\/$/);

  // ── 新建一条已获奖的参赛 ──
  await page.goto("/competitions");
  await page.getByRole("button", { name: "新建参赛" }).click();

  // 库里一条赛事都没有时，赛事下拉默认就停在「＋ 新赛事…」
  await expect(page.locator('select#competitionId')).toHaveValue("__new__");
  await page.locator('input[name="newCompetitionName"]').fill("职业院校技能大赛");
  await page.locator('input[name="track"]').fill("软件测试赛项");
  await page.locator('input[name="year"]').fill("2026");
  await page.locator('select[name="level"]').selectOption("PROVINCIAL");
  await page.locator('input[name="myOrder"]').fill("1");
  await page.locator('select[name="award"]').selectOption("FIRST");
  await page.locator('input[name="awardTitle"]').fill("省一等奖");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已记下这次参赛")).toBeVisible();

  // ── 进详情，引用为成果 ──
  await page.getByRole("link", { name: /职业院校技能大赛/ }).first().click();
  await expect(page).toHaveURL(/\/competitions\/[a-z0-9]+$/);
  const entryUrl = new URL(page.url()).pathname;

  await page.getByRole("button", { name: "引用为成果" }).click();
  // exact：删除区那句说明也以「已引用为成果」开头，不精确匹配会撞上 strict mode
  await expect(page.getByText("已引用为成果", { exact: true })).toBeVisible();

  // 奖状原文原样进标题——评审核对的就是这行字
  const achievementLink = page.getByRole("link", { name: "指导学生获省一等奖" });
  await expect(achievementLink).toBeVisible();
  await achievementLink.click();
  await expect(page).toHaveURL(/\/achievements\/[a-z0-9]+/);

  // ── 这次补的反链：成果详情要说得出自己是哪儿来的 ──
  await expect(page.getByText("指导参赛")).toBeVisible();
  const backLink = page.locator(`a[href="${entryUrl}"]`);
  await expect(backLink).toHaveText("2026 职业院校技能大赛 · 软件测试赛项");
  await backLink.click();
  await expect(page).toHaveURL(new RegExp(`${entryUrl}$`));
});

test("成果页默认职称口径会说清还有多少条没显示，并能一键切到全部", async ({ page }) => {
  const passcode = process.env.E2E_PASSCODE;
  if (!passcode || !process.env.E2E_BASE_URL) {
    throw new Error("E2E tests must be launched by scripts/run-e2e.mjs");
  }

  await page.goto("/login");
  await page.locator('input[name="passcode"]').fill(passcode);
  await page.getByRole("button", { name: "进入" }).click();
  // 等登录落地再跳：不等的话 goto 抢在会话 cookie 写好之前，被弹回登录页
  await expect(page).toHaveURL(/\/$/);

  // 造一条没挂职称指标的成果——这正是「新建完在默认口径下看不见」那种
  await page.goto("/achievements/new");
  await page.locator('input[name="title"]').fill("口径提示验证用成果");
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page.getByRole("heading", { name: "口径提示验证用成果" })).toBeVisible();

  await page.goto("/achievements");
  const hint = page.getByText(/另有\s*\d+\s*条不在本口径/);
  await expect(hint).toBeVisible();

  await page.getByRole("link", { name: "切到「全部」" }).click();
  await expect(page).toHaveURL(/scope=all/);
  // 找表格行，别用 getByText().first()：手机摘要列表和桌面表格两份都渲染、靠 CSS 切，
  // 桌面视口下排在前面的那份手机摘要是隐藏的
  await expect(page.getByRole("row").filter({ hasText: "口径提示验证用成果" })).toBeVisible();
});
