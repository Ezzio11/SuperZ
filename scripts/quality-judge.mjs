#!/usr/bin/env node
/**
 * LLM-based quality judge for SuperZ A/B reports.
 *
 * Pipeline:
 *   1. Load an existing `reports/ab-<ts>.json` file (produced by `ab-test.mjs`).
 *   2. For each row, send the raw response and compressed response to a judge
 *      LLM (different provider by default, to avoid homophily).
 *   3. Record whether the two answers are semantically equivalent for the
 *      ORIGINAL prompt's intent. If `expectedAnswerKey` is present, also
 *      verify that both responses mention it.
 *   4. Emit a quality report and a combined gate result.
 *
 * Usage:
 *   node scripts/quality-judge.mjs reports/ab-<ts>.json
 *
 * Environment:
 *   SUPERZ_JUDGE_PROVIDER  provider name from config (default: OpenRouter-Free)
 *   SUPERZ_JUDGE_MODEL     override judge model slug
 *   SUPERZ_JUDGE_SLEEP_MS  pause between judge calls (default: 1200)
 *   SUPERZ_JUDGE_LIMIT     cap the number of rows judged (default: all)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "../dist/index.js";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/quality-judge.mjs <reports/ab-*.json>");
  process.exit(2);
}
const reportPath = resolve(process.cwd(), args[0]);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
if (!Array.isArray(report.rows)) {
  console.error(`Report ${reportPath} has no rows[]; cannot judge.`);
  process.exit(2);
}

const config = loadConfig();
const JUDGE_NAME = process.env.SUPERZ_JUDGE_PROVIDER ?? "OpenRouter-Free";
const judgeProvider = config.providers.find(
  (p) => p.name.toLowerCase() === JUDGE_NAME.toLowerCase(),
);
if (!judgeProvider || !judgeProvider.apiKey) {
  console.error(
    `Judge provider "${JUDGE_NAME}" not configured or missing API key. ` +
      `Set SUPERZ_JUDGE_PROVIDER to one of your configured provider names.`,
  );
  process.exit(2);
}
const JUDGE_MODEL = process.env.SUPERZ_JUDGE_MODEL ?? judgeProvider.model;
const SLEEP_MS = Math.max(0, Number(process.env.SUPERZ_JUDGE_SLEEP_MS ?? 1200));
const LIMIT = Math.max(1, Number(process.env.SUPERZ_JUDGE_LIMIT ?? report.rows.length));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const JUDGE_SYSTEM = `You are a strict evaluator. You will receive:
1. An ORIGINAL user prompt (possibly long).
2. Two candidate answers: ANSWER_A (produced from the original prompt) and ANSWER_B (produced from a compressed version).
3. Optionally, an EXPECTED_ANSWER_KEY: a short phrase that the correct answer should mention.

Judge ONLY whether the two answers are semantically equivalent for the user's intent. You are not grading writing style.

Respond with a single JSON object, no preamble, no markdown fences:
{"equivalent": true|false, "reason": "<=160 chars", "raw_has_key": true|false|null, "comp_has_key": true|false|null}

- "equivalent" is true when the two answers convey the same factual answer to the user's question.
- "raw_has_key" / "comp_has_key" are true when the answer contains the expected key substring (case-insensitive) and null when no key was provided.
- "reason" is a terse justification in English.`;

function trimForJudge(text, maxChars = 4000) {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.6);
  const tail = maxChars - head - 20;
  return `${text.slice(0, head)}\n...[truncated]...\n${text.slice(-tail)}`;
}

async function callJudge(original, answerA, answerB, expectedAnswerKey) {
  const userContent = [
    `ORIGINAL PROMPT:\n${trimForJudge(original)}`,
    `ANSWER_A:\n${trimForJudge(answerA, 2000)}`,
    `ANSWER_B:\n${trimForJudge(answerB, 2000)}`,
    expectedAnswerKey
      ? `EXPECTED_ANSWER_KEY: ${expectedAnswerKey}`
      : `EXPECTED_ANSWER_KEY: (none)`,
  ].join("\n\n");

  const body = {
    model: JUDGE_MODEL,
    messages: [
      { role: "system", content: JUDGE_SYSTEM },
      { role: "user", content: userContent },
    ],
    temperature: 0,
    max_tokens: 200,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(judgeProvider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${judgeProvider.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Judge HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    return parseJudgeJson(content);
  } finally {
    clearTimeout(timer);
  }
}

function parseJudgeJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  const braceStart = cleaned.indexOf("{");
  const braceEnd = cleaned.lastIndexOf("}");
  if (braceStart === -1 || braceEnd <= braceStart) {
    throw new Error(`Judge response not JSON: ${text.slice(0, 120)}`);
  }
  const slice = cleaned.slice(braceStart, braceEnd + 1);
  const parsed = JSON.parse(slice);
  return {
    equivalent: Boolean(parsed.equivalent),
    reason: String(parsed.reason ?? "").slice(0, 200),
    rawHasKey: parsed.raw_has_key === null ? null : Boolean(parsed.raw_has_key),
    compHasKey: parsed.comp_has_key === null ? null : Boolean(parsed.comp_has_key),
  };
}

async function main() {
  console.log("=== SuperZ Quality Judge ===");
  console.log(`report       = ${reportPath}`);
  console.log(`judge        = ${judgeProvider.name} (${JUDGE_MODEL})`);
  console.log(`rows         = ${Math.min(LIMIT, report.rows.length)}`);
  console.log(`sleep_ms     = ${SLEEP_MS}`);

  const evaluations = [];
  const rows = report.rows.slice(0, LIMIT);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    process.stdout.write(`[${i + 1}/${rows.length}] judging... `);
    let verdict;
    try {
      verdict = await callJudge(
        row.prompt ?? "",
        row.rawResponse ?? "",
        row.compResponse ?? "",
        row.expectedAnswerKey ?? null,
      );
    } catch (err) {
      console.log(`failed (${err.message ?? err})`);
      evaluations.push({
        idx: row.idx,
        label: row.label ?? null,
        error: err.message ?? String(err),
        equivalent: null,
      });
      await sleep(SLEEP_MS);
      continue;
    }
    console.log(
      `equivalent=${verdict.equivalent} rawHasKey=${verdict.rawHasKey ?? "-"} compHasKey=${verdict.compHasKey ?? "-"}`,
    );
    evaluations.push({
      idx: row.idx,
      label: row.label ?? null,
      expectedAnswerKey: row.expectedAnswerKey ?? null,
      equivalent: verdict.equivalent,
      reason: verdict.reason,
      rawHasKey: verdict.rawHasKey,
      compHasKey: verdict.compHasKey,
      reduction: row.reduction ?? 0,
      saved: row.saved ?? 0,
    });
    await sleep(SLEEP_MS);
  }

  const usable = evaluations.filter((e) => e.equivalent !== null);
  const equivalentCount = usable.filter((e) => e.equivalent).length;
  const rawHasKeyCount = usable.filter((e) => e.rawHasKey === true).length;
  const compHasKeyCount = usable.filter((e) => e.compHasKey === true).length;
  const keyEvaluable = usable.filter((e) => e.rawHasKey !== null).length;

  const summary = {
    report: reportPath,
    judge: { provider: judgeProvider.name, model: JUDGE_MODEL },
    total: evaluations.length,
    evaluable: usable.length,
    semanticEquivalenceRate: usable.length > 0 ? equivalentCount / usable.length : 0,
    answerKeyRawHitRate: keyEvaluable > 0 ? rawHasKeyCount / keyEvaluable : null,
    answerKeyCompHitRate: keyEvaluable > 0 ? compHasKeyCount / keyEvaluable : null,
    perPrompt: evaluations,
  };

  console.log("\n=== Judge Summary ===");
  console.log(`total=${summary.total}  evaluable=${summary.evaluable}`);
  console.log(
    `semantic_equivalence_rate=${(summary.semanticEquivalenceRate * 100).toFixed(2)}%`,
  );
  if (summary.answerKeyRawHitRate !== null) {
    console.log(
      `expected_key_hit_rate_raw=${(summary.answerKeyRawHitRate * 100).toFixed(2)}%`,
    );
    console.log(
      `expected_key_hit_rate_compressed=${(summary.answerKeyCompHitRate * 100).toFixed(2)}%`,
    );
  }

  const outPath = reportPath.replace(/\.json$/, ".judge.json");
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${outPath}`);

  // Gate decision.
  const gate = {
    reductionOk: (report.aggregate?.meanReductionRatio ?? 0) >= 0.25,
    semanticOk: summary.semanticEquivalenceRate >= 0.9,
    constraintOk:
      (report.aggregate?.constraintSurvival?.negation ?? 1) >= 0.99 &&
      (report.aggregate?.constraintSurvival?.numeric ?? 1) >= 0.99 &&
      (report.aggregate?.constraintSurvival?.schema ?? 1) >= 0.99,
  };
  gate.passed = gate.reductionOk && gate.semanticOk && gate.constraintOk;
  console.log("\n=== Gate ===");
  console.log(`reduction>=25%:        ${gate.reductionOk ? "PASS" : "FAIL"}`);
  console.log(`semantic>=90%:         ${gate.semanticOk ? "PASS" : "FAIL"}`);
  console.log(`constraint survival:   ${gate.constraintOk ? "PASS" : "FAIL"}`);
  console.log(`overall:               ${gate.passed ? "PASS" : "FAIL"}`);

  if (!gate.passed) {
    process.exitCode = 3;
  }
}

main().catch((err) => {
  console.error("Quality judge failed:", err);
  process.exit(1);
});
