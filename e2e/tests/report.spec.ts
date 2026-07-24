import { expect, gotoApp, startMockedTypingConversation, test } from "../support/test";
import { readFixture } from "../support/fixtures";

test("模块 5/10.1：复盘报告生成中、失败、就绪三态都可渲染", async ({ page }) => {
  const readyReport = readFixture<Record<string, unknown>>("report-ready.json");
  let mode: "delayed-success" | "failure" = "delayed-success";
  let releaseReport: (() => void) | null = null;

  await page.route("**/api/generate-report", async (route) => {
    if (mode === "failure") {
      await route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "not-json",
      });
      return;
    }

    await new Promise<void>((resolve) => {
      releaseReport = resolve;
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readyReport),
    });
  });

  await gotoApp(page);
  await startMockedTypingConversation(page);
  await page.getByRole("button", { name: "结束并复盘" }).click();
  await expect(page.getByText("小榜正在整理今天的复盘…")).toBeVisible();

  releaseReport?.();
  await expect(page.getByText("这次复盘")).toBeVisible();
  await expect(page.getByText("你把上次学的用出来了")).toBeVisible();
  await expect(page.getByText("I really like coffee")).toBeVisible();
  await page.getByRole("button", { name: "完成练习" }).click();
  await expect(page.getByText("选择场景")).toBeVisible();

  mode = "failure";
  await startMockedTypingConversation(page);
  await page.getByRole("button", { name: "结束并复盘" }).click();
  await expect(page.getByText(/Unexpected token|not valid JSON/)).toBeVisible();
  await expect(page.getByRole("button", { name: "返回对话重试" })).toBeVisible();
});
