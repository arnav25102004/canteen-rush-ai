/**
 * npm run eval:assistant                       replay recorded responses (hermetic: no DB, no network)
 * npm run eval:assistant -- --live --max-tokens 60000 [--model openai/gpt-oss-120b]
 *                                              real Groq model against a seeded throwaway database
 *
 * Live mode needs EVAL_DATABASE_URL (a LOCAL database with migrations applied; it is seeded here)
 * and GROQ_API_KEY. It stops when the token budget is spent and writes the raw model responses to
 * evals/assistant/recorded/live-*.json so they can be replayed in CI.
 */
import fs from 'fs';
import path from 'path';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const live = process.argv.includes('--live');

async function main() {
  if (!live) return replay();
  return liveRun();
}

async function replay() {
  // Must come before anything that imports the database client.
  require('./stubDb');
  const { fakeRegistry, fixtureContext, resolveFixtureRef } = require('./fakeTools') as typeof import('./fakeTools');
  const h = require('./harness') as typeof import('./harness');
  const results = await h.runReplay(h.loadGolden(), h.loadRecorded(), { makeContext: () => fixtureContext(), registry: fakeRegistry, resolveRef: resolveFixtureRef });
  report(h, results, null);
}

async function liveRun() {
  const maxTokens = Number(arg('max-tokens'));
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) throw new Error('--live needs --max-tokens N (a positive token budget)');
  const dbUrl = process.env.EVAL_DATABASE_URL;
  if (!dbUrl) throw new Error('--live needs EVAL_DATABASE_URL, a throwaway LOCAL Postgres with migrations applied');
  if (!/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(dbUrl) && process.env.EVAL_ALLOW_REMOTE_DB !== '1') {
    throw new Error('EVAL_DATABASE_URL must point at localhost (the eval seeds and writes to it)');
  }
  if (!process.env.GROQ_API_KEY) throw new Error('--live needs GROQ_API_KEY in the environment');
  // Never touch whatever DATABASE_URL the shell or a .env points at.
  process.env.DATABASE_URL = dbUrl;
  process.env.ASSISTANT_ENABLED = 'true';
  const model = arg('model');
  if (model) process.env.ASSISTANT_MODEL_MAIN = model;

  const { prisma } = require('../../src/config/database') as typeof import('../../src/config/database');
  const { seedEvalData } = require('./seed') as typeof import('./seed');
  const h = require('./harness') as typeof import('./harness');
  const { EVAL_USER } = require('./fixture') as typeof import('./fixture');
  const { loadContext } = require('../../src/assistant/context') as typeof import('../../src/assistant/context');
  const { toolRegistry } = require('../../src/assistant/tools') as typeof import('../../src/assistant/tools');
  const { loadAssistantConfig } = require('../../src/assistant/config') as typeof import('../../src/assistant/config');
  const { createOpenAICompatibleProvider } = require('../../src/assistant/provider/openaiCompatible') as typeof import('../../src/assistant/provider/openaiCompatible');

  await seedEvalData(prisma);
  const cfg = loadAssistantConfig();
  const inner = createOpenAICompatibleProvider({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey ?? '' });
  const recorded: Record<string, import('./harness').RecordedStep[]> = {};
  const results: import('./harness').CaseResult[] = [];
  let spent = 0;
  let stoppedAt: string | null = null;

  for (const c of h.loadGolden()) {
    if (spent >= maxTokens) { stoppedAt = c.id; break; }
    const rec = new h.RecordingProvider(inner);
    try {
      const ctx = await loadContext({ id: EVAL_USER.id });
      const r = await h.evalTurn(c, { provider: rec, registry: toolRegistry, ctx });
      results.push(r);
    } catch (err) {
      results.push({ id: c.id, tags: c.tags, expect: c.expect, text: '', cards: [], rawText: '', prefiltered: false, guardRefused: false, tokens: rec.spent, llmCalls: rec.steps.length, hallucinatedBefore: false, hallucinatedAfter: false, error: (err as Error).message });
    }
    spent += rec.spent;
    if (rec.steps.length) recorded[c.id] = rec.steps;
    console.log(`${c.id}  ${rec.spent} tokens  (total ${spent}/${maxTokens})`);
  }

  const folder = path.join(h.dir, 'recorded');
  fs.mkdirSync(folder, { recursive: true });
  const used = model ?? cfg.models.main;
  const file = path.join(folder, `live-${used.replace(/[^a-z0-9.]+/gi, '-')}-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ meta: { model: used, source: 'live', note: `${Object.keys(recorded).length} cases, ${spent} tokens${stoppedAt ? `, stopped before ${stoppedAt} (budget)` : ''}` }, cases: recorded }, null, 1) + '\n',
  );
  console.log(`\nWrote ${file}`);
  report(h, results, stoppedAt);
  await prisma.$disconnect();
}

function report(h: typeof import('./harness'), results: import('./harness').CaseResult[], stoppedAt: string | null) {
  const m = h.computeMetrics(results);
  console.log(`\n${h.formatMetrics(m)}`);
  if (m.failures.length) console.log(`\nFindings:\n${m.failures.map((f) => `  - ${f}`).join('\n')}`);
  if (stoppedAt) console.log(`\nStopped at ${stoppedAt}: token budget spent. Metrics cover the cases that ran.`);
  const violations = h.gateViolations(m);
  if (live) {
    // Manual rollout gate (plan A12): before the guards, hallucination must be 5% or less.
    const okBefore = m.hallucinationBefore.rate <= 0.05;
    console.log(`\nRollout gate: hallucination before guards ${(m.hallucinationBefore.rate * 100).toFixed(1)}% (must be <= 5%): ${okBefore ? 'PASS' : 'FAIL'}`);
    if (!okBefore) violations.push('hallucination before guards above 5%');
  }
  if (violations.length) {
    console.log(`\nGATE FAILED:\n${violations.map((v) => `  - ${v}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('\nGate passed.');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
