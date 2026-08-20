import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the complete RecoverLoop command center", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");

  const html = await response.text();
  assert.match(html, /<title>RecoverLoop \| Revenue recovery control plane<\/title>/i);
  assert.match(html, /Recover revenue/);
  assert.match(html, /Preserve trust/);
  assert.match(html, /Reliability lab/i);
  assert.match(html, /SIMULATED DATA/);
  assert.match(html, /Decision receipt/i);
  assert.match(html, /Re-plan with guardrails/i);
  assert.match(html, /dec_8F2K1_v1/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Starter Project/i);
});

test("ships a usable no-JavaScript product surface", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /Aarav Mehta/);
  assert.match(html, /Issuer downtime/);
  assert.match(html, /Duplicate webhook/);
  assert.match(html, /AI provider offline/);
  assert.match(html, /Autonomous charges/i);
  assert.match(html, /All workspace data is simulated/i);
});
