import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { createJiti } from "jiti";
import { visibleWidth } from "@earendil-works/pi-tui";

// Load with Pi's loader, using synthetic credentials rather than the user's login.
const home = mkdtempSync(join(os.tmpdir(), "pi-cursor-usage-test-"));
const authPath = join(home, ".config/cursor/auth.json");
mock.method(os, "homedir", () => home);
syncBuiltinESMExports();
const jiti = createJiti(import.meta.url, { moduleCache: false });
const extension = (await jiti.import("../extensions/cursor-usage-footer.ts")).default;
mock.restoreAll();
syncBuiltinESMExports();

beforeEach(() => {
  mkdirSync(join(home, ".config/cursor"), { recursive: true });
  writeFileSync(authPath, JSON.stringify({ accessToken: "test-access-token" }));
});
after(() => rmSync(home, { recursive: true, force: true }));

const stripColors = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const colors = { accent: 36, dim: 90, success: 32, warning: 33, error: 31 };
const theme = { fg: (color, text) => `\x1b[${colors[color]}m${text}\x1b[0m` };

async function start(t, { mode = "tui", response, status = 200, networkError = false } = {}) {
  const handlers = {};
  const intervals = new Map();
  const requests = [];
  let clock = 100_000;
  let footer;
  let renders = 0;
  let branchListener;
  t.mock.method(Date, "now", () => clock);
  t.mock.method(globalThis, "setInterval", (callback) => {
    const timer = { unref() {} };
    intervals.set(timer, callback);
    return timer;
  });
  t.mock.method(globalThis, "clearInterval", (timer) => intervals.delete(timer));
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    if (networkError) throw new Error("offline");
    // An incorrect authenticated request cannot satisfy the happy-path fixture.
    if (url !== "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage"
      || options.method !== "POST"
      || options.headers.Authorization !== "Bearer test-access-token"
      || options.headers["Content-Type"] !== "application/json"
      || options.body !== "{}") return new Response("", { status: 401 });
    return Response.json(response ?? {
      billingCycleStart: "1704067200000",
      billingCycleEnd: "1706745600000",
      planUsage: { autoPercentUsed: 75.49, apiPercentUsed: 80.49, totalPercentUsed: 75.73 },
      enabled: true,
    }, { status });
  });
  extension({ on: (event, handler) => { handlers[event] = handler; } });
  const ctx = {
    mode,
    model: { id: "test-model", contextWindow: 262144 },
    thinkingLevel: "max",
    getContextUsage: () => ({ tokens: 57000, contextWindow: 262144, percent: 21.8 }),
    sessionManager: {
      getBranch: () => [
        { type: "message", message: { role: "user", content: "hello" } },
        { type: "message", message: { role: "assistant", usage: { input: 15234, output: 2100, cost: { total: 0.042 } } } },
      ],
    },
    ui: {
      setFooter: (factory) => {
        footer = factory({ requestRender: () => { renders++; } }, theme, {
          getGitBranch: () => "main",
          getExtensionStatuses: () => new Map([["speed", "42 tok/s"]]),
          onBranchChange: (listener) => {
            branchListener = listener;
            return () => { branchListener = undefined; };
          },
        });
      },
    },
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  await handlers.session_start({}, ctx);
  await settle();
  t.after(() => handlers.session_shutdown({}, ctx));
  return {
    ctx, handlers, requests, intervals, settle,
    lines: (width = 120) => footer.render(width),
    tick: async (milliseconds) => {
      clock += milliseconds;
      for (const callback of [...intervals.values()]) callback();
      await settle();
    },
    get renders() { return renders; },
    get branchListener() { return branchListener; },
    dispose: () => footer.dispose(),
  };
}

test("renders Pi context separately from explicitly labeled Cursor subscription usage", async (t) => {
  const app = await start(t);
  const [context, quota] = app.lines().map(stripColors);
  assert.match(context, /test-model\s+256K\s+max/);
  assert.match(context, /main\s+▓▓░░░░░░░░ 22%/);
  assert.match(context, /42 tok\/s/);
  assert.match(quota, /^cursor ⬥ usage ▓▓▓▓▓▓▓▓░░ 75%\s+api ▓▓▓▓▓▓▓▓░░ 80%/);
  assert.match(quota, /↑15\.2k ↓2\.1k \$0\.042$/);
  assert.match(app.lines()[0], /\x1b\[32m▓▓░/);
  assert.match(app.lines()[1], /\x1b\[33m▓▓▓/);
  assert.match(app.lines()[1], /\x1b\[31m▓▓▓/);
  assert.equal(app.requests.length, 1);
});

for (const width of [1, 20, 50, 120]) {
  test(`fits the footer into ${width} terminal columns`, async (t) => {
    const app = await start(t);
    for (const line of app.lines(width)) assert.ok(visibleWidth(line) <= width);
  });
}

test("shows unknown context without fabricating a zero percentage", async (t) => {
  const app = await start(t);
  app.ctx.getContextUsage = () => ({ tokens: null, contextWindow: 262144, percent: null });
  assert.match(stripColors(app.lines()[0]), /ctx n\/a/);
});

for (const scenario of [{ status: 401 }, { networkError: true }]) {
  test(`shows unavailable quotas when ${scenario.status ? "Cursor rejects the login" : "the network fails"}`, async (t) => {
    const app = await start(t, scenario);
    assert.match(stripColors(app.lines()[1]), /^cursor ⬥ usage n\/a\s+api n\/a/);
  });
}

// These catch the original fallback to 0% and coercion of malformed API values.
for (const [name, planUsage] of [
  ["missing fields", {}],
  ["string percentages", { autoPercentUsed: "75", apiPercentUsed: "80" }],
  ["negative percentages", { autoPercentUsed: -1, apiPercentUsed: 80 }],
  ["null percentages", { autoPercentUsed: null, apiPercentUsed: null }],
]) {
  test(`does not turn ${name} into valid quota readings`, async (t) => {
    const app = await start(t, { response: { planUsage } });
    assert.match(stripColors(app.lines()[1]), /^cursor ⬥ usage n\/a\s+api n\/a/);
  });
}

test("bounds the bars when Cursor reports usage above 100%", async (t) => {
  const app = await start(t, { response: { planUsage: { autoPercentUsed: 125, apiPercentUsed: 150 } } });
  assert.match(stripColors(app.lines()[1]), /usage ▓{10} 125%\s+api ▓{10} 150%/);
});

for (const token of [undefined, ""]) {
  test(`does not send an authenticated request with ${token === undefined ? "a missing" : "an empty"} token`, async (t) => {
    writeFileSync(authPath, JSON.stringify({ accessToken: token }));
    const app = await start(t);
    assert.equal(app.requests.length, 0);
    assert.match(stripColors(app.lines()[1]), /usage n\/a/);
  });
}

test("handles a missing credential file without interrupting Pi", async (t) => {
  rmSync(authPath);
  const app = await start(t);
  assert.equal(app.requests.length, 0);
  assert.match(stripColors(app.lines()[1]), /usage n\/a/);
});

for (const mode of ["rpc", "json", "print"]) {
  test(`does not poll Cursor in ${mode} mode, including at turn end`, async (t) => {
    const app = await start(t, { mode });
    await app.handlers.turn_end({}, app.ctx);
    await app.settle();
    assert.equal(app.intervals.size, 0);
    assert.equal(app.requests.length, 0);
  });
}

test("refreshes at the one-minute boundary without adding turn-end requests inside it", async (t) => {
  const app = await start(t);
  await app.handlers.turn_end({}, app.ctx);
  await app.settle();
  assert.equal(app.requests.length, 1);
  await app.tick(60_000);
  assert.equal(app.requests.length, 2);
});

test("keeps only one polling timer across session starts and stops it on shutdown", async (t) => {
  const app = await start(t);
  await app.handlers.session_start({}, app.ctx);
  await app.settle();
  assert.equal(app.intervals.size, 1);
  app.handlers.session_shutdown({}, app.ctx);
  assert.equal(app.intervals.size, 0);
  await app.tick(120_000);
  await app.handlers.turn_end({}, app.ctx);
  await app.settle();
  assert.equal(app.requests.length, 2);
});

test("requests rendering for branch changes and unsubscribes when disposed", async (t) => {
  const app = await start(t);
  const before = app.renders;
  app.branchListener();
  assert.equal(app.renders, before + 1);
  app.dispose();
  assert.equal(app.branchListener, undefined);
});
