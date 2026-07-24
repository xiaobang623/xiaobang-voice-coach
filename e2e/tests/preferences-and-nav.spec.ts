import { expect, gotoApp, test } from "../support/test";

test("模块 4/12/13：底部导航可切换，游客偏好写入 localStorage 并刷新后保留", async ({ page }) => {
  await gotoApp(page);

  await page.getByRole("button", { name: "我的" }).click();
  await expect(page.getByRole("heading", { name: "游客" })).toBeVisible();
  await page.getByRole("button", { name: "练习" }).click();
  await expect(page.getByText("选择场景")).toBeVisible();

  await page.getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "偏好与账号" }).click();
  await expect(page.getByText("练习默认")).toBeVisible();
  await page.getByRole("button", { name: "快" }).click();
  await page.getByRole("switch").click();

  await expect.poll(async () =>
    page.evaluate(() => window.localStorage.getItem("xiaobang.practice.prefs")),
  ).toContain('"speedRatio":1.25');
  await expect.poll(async () =>
    page.evaluate(() => window.localStorage.getItem("xiaobang.practice.prefs")),
  ).toContain('"showSubtitle":false');

  await page.reload();
  await expect(page.getByText("准备好开口了吗")).toBeVisible();
  await page.getByRole("button", { name: "今天过得怎么样" }).click();
  await expect(page.getByRole("button", { name: "我准备好了" })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole("button", { name: "我准备好了" }).click();
  await expect(page.getByText(/麦克风开着|小榜在听/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "练习设置" }).click();
  await expect(page.getByRole("button", { name: "语速 快" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTitle("打开字幕")).toBeVisible();
});
