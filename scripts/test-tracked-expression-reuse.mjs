import assert from "node:assert/strict";
import {
  applyTrackedExpressionReuse,
  extractUserUtterances,
  matchTrackedExpressions,
  normalizeExpressionForMatch,
  preserveTrackedExpressionReuse,
} from "../src/core/trackedExpressionReuse.ts";
import { postProcessMemory } from "../memory-post-process.js";

const NOW = "2026-07-14T12:00:00.000Z";

function expression(overrides = {}) {
  return {
    id: "expr-scrambled-eggs",
    sourceType: "newExpression",
    originalText: "I made eggs.",
    targetText: "scrambled eggs",
    category: "搭配",
    status: "unmastered",
    firstSeenAt: "2026-07-13T12:00:00.000Z",
    lastSeenAt: "2026-07-13T12:00:00.000Z",
    reuseCount: 0,
    ...overrides,
  };
}

function summary(trackedExpressions) {
  return {
    userLevel: "intermediate",
    topics: ["breakfast"],
    frequentMistakes: [],
    trackedExpressions,
    personalFacts: [],
    coachNotes: "",
    updatedAt: "2026-07-13T12:00:00.000Z",
  };
}

function testNormalizationAndUserOnlyExtraction() {
  assert.equal(normalizeExpressionForMatch("  Scrambled—Eggs!! "), "scrambled eggs");

  const utterances = extractUserUtterances(`Coach: Try saying scrambled eggs.\nUser: I cooked scrambled eggs today!`);
  assert.equal(utterances.length, 1);
  assert.equal(utterances[0].raw, "I cooked scrambled eggs today!");
}

function testUnmasteredToReviewing() {
  const result = applyTrackedExpressionReuse(
    summary([expression()]),
    "Coach: What did you eat?\nUser: I ate scrambled eggs this morning.",
    NOW,
  );

  assert.equal(result.reusedExpressions.length, 1);
  assert.equal(result.reusedExpressions[0].currentText, "I ate scrambled eggs this morning.");
  assert.equal(result.reusedExpressions[0].statusBefore, "unmastered");
  assert.equal(result.reusedExpressions[0].statusAfter, "reviewing");
  assert.equal(result.reusedExpressions[0].reuseCount, 1);
  assert.equal(result.summary.trackedExpressions[0].status, "reviewing");
  assert.equal(result.summary.trackedExpressions[0].reuseCount, 1);
  assert.equal(result.summary.trackedExpressions[0].lastSeenAt, NOW);
}

function testReviewingToMastered() {
  const result = applyTrackedExpressionReuse(
    summary([expression({ status: "reviewing", reuseCount: 1 })]),
    "User: My favorite breakfast is scrambled eggs.",
    NOW,
  );

  assert.equal(result.reusedExpressions.length, 1);
  assert.equal(result.summary.trackedExpressions[0].status, "mastered");
  assert.equal(result.summary.trackedExpressions[0].reuseCount, 2);
}

function testMasteredAndCoachLinesDoNotMatch() {
  assert.equal(
    matchTrackedExpressions("Coach: You can say scrambled eggs.", [expression()]).length,
    0,
  );
  assert.equal(
    matchTrackedExpressions("User: I ate scrambled eggs.", [
      expression({ status: "mastered", reuseCount: 2 }),
    ]).length,
    0,
  );
}

function testSimilarityFallbackIsConservative() {
  const matches = matchTrackedExpressions("User: I am trying to get on same page with my team.", [
    expression({ id: "expr-page", targetText: "get on the same page" }),
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].expressionId, "expr-page");

  const misses = matchTrackedExpressions("User: I ate eggs today.", [
    expression({ targetText: "scrambled eggs" }),
  ]);
  assert.equal(misses.length, 0);
}

function testLightVerbContentPhraseMatching() {
  const makeScrambledEggs = expression({
    id: "expr-make-scrambled-eggs",
    targetText: "make scrambled eggs",
  });

  const hadMatches = matchTrackedExpressions("User: I had scrambled eggs for dinner.", [
    makeScrambledEggs,
  ]);
  assert.equal(hadMatches.length, 1);
  assert.equal(hadMatches[0].expressionId, "expr-make-scrambled-eggs");
  assert.equal(hadMatches[0].currentText, "I had scrambled eggs for dinner.");

  const scrambleMisses = matchTrackedExpressions("User: I made a scramble eggs.", [
    makeScrambledEggs,
  ]);
  assert.equal(scrambleMisses.length, 0);

  const missingEggsMisses = matchTrackedExpressions("User: I have scrambled.", [
    makeScrambledEggs,
  ]);
  assert.equal(missingEggsMisses.length, 0);
}

function testLightVerbRuleDoesNotApplyToExcludedIdioms() {
  const idiom = expression({
    id: "expr-get-used-to",
    targetText: "get used to something",
  });

  const matches = matchTrackedExpressions("User: I am used to something now.", [idiom]);
  assert.equal(matches.length, 0);
}

function testPreserveGuardWinsOverExtractedMemory() {
  const reuseUpdated = summary([
    expression({ status: "reviewing", reuseCount: 1, lastSeenAt: NOW }),
  ]);
  const extracted = summary([
    expression({ status: "unmastered", reuseCount: 0, lastSeenAt: "2026-07-13T12:00:00.000Z" }),
  ]);
  const guarded = preserveTrackedExpressionReuse(extracted, reuseUpdated, [
    {
      expressionId: "expr-scrambled-eggs",
      previousOriginalText: "I made eggs.",
      targetText: "scrambled eggs",
      currentText: "I ate scrambled eggs.",
      statusBefore: "unmastered",
      statusAfter: "reviewing",
      reuseCount: 1,
    },
  ]);

  assert.equal(guarded.trackedExpressions[0].status, "reviewing");
  assert.equal(guarded.trackedExpressions[0].reuseCount, 1);
  assert.equal(guarded.trackedExpressions[0].lastSeenAt, NOW);
}

function testStep1MemoryMergeKeepsReuseStateWhenSameTargetIsRemapped() {
  const reuseUpdated = summary([
    expression({ status: "reviewing", reuseCount: 1, lastSeenAt: NOW }),
  ]);

  const processed = postProcessMemory(
    {
      userLevel: "intermediate",
      topics: ["breakfast"],
      frequentMistakes: [],
      coachNotes: "",
    },
    {
      previousSummary: reuseUpdated,
      report: {
        corrections: [],
        growth: {
          newExpressions: [{ phrase: "scrambled eggs", meaning: "炒蛋", example: "I had scrambled eggs." }],
        },
      },
      now: NOW,
      ownerKey: "user-1",
    },
  );

  assert.equal(processed.summary.trackedExpressions.length, 1);
  assert.equal(processed.summary.trackedExpressions[0].targetText, "scrambled eggs");
  assert.equal(processed.summary.trackedExpressions[0].status, "reviewing");
  assert.equal(processed.summary.trackedExpressions[0].reuseCount, 1);
}

testNormalizationAndUserOnlyExtraction();
testUnmasteredToReviewing();
testReviewingToMastered();
testMasteredAndCoachLinesDoNotMatch();
testSimilarityFallbackIsConservative();
testLightVerbContentPhraseMatching();
testLightVerbRuleDoesNotApplyToExcludedIdioms();
testPreserveGuardWinsOverExtractedMemory();
testStep1MemoryMergeKeepsReuseStateWhenSameTargetIsRemapped();

console.log("tracked expression reuse tests passed");
