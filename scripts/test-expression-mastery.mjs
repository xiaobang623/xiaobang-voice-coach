import assert from "node:assert/strict";
import {
  groupTrackedExpressionsByStatus,
  MASTERY_TABS,
} from "../src/core/trackedExpressionMastery.ts";

function expression(overrides = {}) {
  return {
    id: overrides.id ?? "expr-default",
    sourceType: "correction",
    originalText: "I go yesterday",
    targetText: "I went yesterday",
    category: "语法",
    status: "unmastered",
    firstSeenAt: "2026-07-10T00:00:00.000Z",
    lastSeenAt: "2026-07-10T00:00:00.000Z",
    reuseCount: 0,
    ...overrides,
  };
}

function testGroupingAndRecentFirstSorting() {
  const groups = groupTrackedExpressionsByStatus([
    expression({ id: "old", targetText: "older", lastSeenAt: "2026-07-10T00:00:00.000Z" }),
    expression({ id: "mastered", status: "mastered", targetText: "done", reuseCount: 2 }),
    expression({ id: "new", targetText: "newer", lastSeenAt: "2026-07-12T00:00:00.000Z" }),
    expression({ id: "reviewing", status: "reviewing", targetText: "in progress", reuseCount: 1 }),
  ]);

  assert.deepEqual(groups.unmastered.map((item) => item.id), ["new", "old"]);
  assert.deepEqual(groups.reviewing.map((item) => item.id), ["reviewing"]);
  assert.deepEqual(groups.mastered.map((item) => item.id), ["mastered"]);
}

function testEmptyStateCopyExistsForEveryTab() {
  assert.deepEqual(
    MASTERY_TABS.map((tab) => [tab.status, tab.emptyText]),
    [
      ["unmastered", "太棒了，暂时没有未掌握的表达"],
      ["reviewing", "还没有正在复习的表达，用上一次学过的说法就会出现在这里"],
      ["mastered", "还没有已掌握的表达，继续聊，说对两次就会出现在这里"],
    ],
  );
}

function testUnknownStatusesAreIgnored() {
  const groups = groupTrackedExpressionsByStatus([
    expression({ id: "valid", status: "reviewing" }),
    expression({ id: "invalid", status: "archived" }),
  ]);

  assert.deepEqual(groups.unmastered, []);
  assert.deepEqual(groups.reviewing.map((item) => item.id), ["valid"]);
  assert.deepEqual(groups.mastered, []);
}

testGroupingAndRecentFirstSorting();
testEmptyStateCopyExistsForEveryTab();
testUnknownStatusesAreIgnored();

console.log("expression mastery tests passed");
