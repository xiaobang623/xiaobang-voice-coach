import assert from "node:assert/strict";
import {
  buildTrackedExpressionsFromReport,
  makeTrackedExpressionId,
  mapCorrectionCategory,
  mergeTrackedExpressions,
  normalizeExpressionKey,
} from "../memory-post-process.js";
import {
  buildLegacyTrackedExpression,
  parseLegacyFrequentMistake,
} from "./backfill-tracked-expressions.mjs";

const NOW = "2026-07-14T12:00:00.000Z";

function testNormalizeDedup() {
  assert.equal(normalizeExpressionKey("  Hello, World!  "), "hello world");
  assert.equal(normalizeExpressionKey("“Hello”   world."), "hello world");

  const existing = [
    {
      id: "existing-1",
      sourceType: "correction",
      originalText: "hello world",
      targetText: "Hello, world!",
      category: "语法",
      status: "reviewing",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-02T00:00:00.000Z",
      reuseCount: 3,
      nextReviewAt: "2026-01-10T00:00:00.000Z",
    },
  ];
  const incoming = [
    {
      id: "incoming-1",
      sourceType: "sayBetter",
      originalText: "",
      targetText: "hello world",
      category: "地道",
      status: "unmastered",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      reuseCount: 0,
    },
  ];

  const merged = mergeTrackedExpressions(existing, incoming, NOW);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "existing-1");
  assert.equal(merged[0].sourceType, "correction");
  assert.equal(merged[0].category, "语法");
  assert.equal(merged[0].status, "reviewing");
  assert.equal(merged[0].firstSeenAt, "2026-01-01T00:00:00.000Z");
  assert.equal(merged[0].reuseCount, 3);
  assert.equal(merged[0].nextReviewAt, "2026-01-10T00:00:00.000Z");
  assert.equal(merged[0].lastSeenAt, NOW);
}

function testCategoryMappingAndReportMapping() {
  assert.equal(mapCorrectionCategory("grammar"), "语法");
  assert.equal(mapCorrectionCategory("collocation"), "搭配");
  assert.equal(mapCorrectionCategory("vocabulary"), "用词");
  assert.equal(mapCorrectionCategory("naturalness"), "地道");
  assert.equal(mapCorrectionCategory("structure"), "句式");
  assert.equal(mapCorrectionCategory("unknown"), "未分类");

  const expressions = buildTrackedExpressionsFromReport(
    {
      corrections: [
        { original: "I go yesterday", corrected: "I went yesterday", type: "grammar" },
      ],
      growth: {
        sayBetter: [{ original: "It is good", upgraded: "It works really well" }],
        newExpressions: [{ phrase: "on the same page", meaning: "agree", example: "..." }],
      },
    },
    { now: NOW, ownerKey: "user-1" },
  );

  assert.equal(expressions.length, 3);
  assert.equal(expressions[0].sourceType, "correction");
  assert.equal(expressions[0].category, "语法");
  assert.equal(expressions[1].sourceType, "sayBetter");
  assert.equal(expressions[1].category, "地道");
  assert.equal(expressions[2].sourceType, "newExpression");
  assert.equal(expressions[2].category, "搭配");
  assert.equal(expressions[2].originalText, "");
}

function testLegacyParsingAndCategory() {
  assert.deepEqual(parseLegacyFrequentMistake("wrong -> right"), {
    originalText: "wrong",
    targetText: "right",
  });
  assert.deepEqual(parseLegacyFrequentMistake("wrong => 'right'"), {
    originalText: "wrong",
    targetText: "right",
  });
  assert.deepEqual(parseLegacyFrequentMistake("标签: 'maybe eggs' → 'I made eggs'"), {
    originalText: "maybe eggs",
    targetText: "I made eggs",
  });

  const legacy = buildLegacyTrackedExpression({
    userId: "user-1",
    rawText: "标签: 'maybe eggs' → 'I made eggs'",
    seenAt: NOW,
  });
  assert.equal(legacy.category, "未分类");
  assert.equal(legacy.sourceType, "correction");
  assert.equal(legacy.status, "unmastered");
  assert.equal(legacy.reuseCount, 0);
}

function testDeterministicIds() {
  const first = makeTrackedExpressionId("correction", "I went yesterday.", "user-1");
  const second = makeTrackedExpressionId("correction", "I went yesterday.", "user-1");
  assert.equal(first, second);

  const legacyFirst = buildLegacyTrackedExpression({
    userId: "user-1",
    rawText: "I go yesterday → I went yesterday",
    seenAt: NOW,
  });
  const legacySecond = buildLegacyTrackedExpression({
    userId: "user-1",
    rawText: "I go yesterday → I went yesterday",
    seenAt: NOW,
  });
  assert.equal(legacyFirst.id, legacySecond.id);
  assert.match(legacyFirst.id, /^legacy-[a-f0-9]{32}$/);
}

testNormalizeDedup();
testCategoryMappingAndReportMapping();
testLegacyParsingAndCategory();
testDeterministicIds();

console.log("tracked expressions tests passed");
