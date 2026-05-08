import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  botFilterMiddleware,
  DEFAULT_BOT_UA_PATTERN,
} from "./bot-filter.ts";

function appWithFilter(opts: Parameters<typeof botFilterMiddleware>[0]): Hono {
  const app = new Hono();
  app.use("*", botFilterMiddleware(opts));
  app.all("*", (c) => c.text("FELL_THROUGH", 200));
  return app;
}

test("DEFAULT_BOT_UA_PATTERN matches known scanner/SEO bots", () => {
  for (const ua of [
    "Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)",
    "Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)",
    "Mozilla/5.0 (compatible; DotBot/1.2; +https://opensiteexplorer.org/dotbot)",
    "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
    "Mozilla/5.0 (Nikto/2.1.6)",
    "sqlmap/1.6.4#stable (https://sqlmap.org)",
    "WPScan v3.8.22",
    "masscan/1.3",
    "Nmap Scripting Engine; https://nmap.org/book/nse.html",
    "Nuclei - Open-source project (github.com/projectdiscovery/nuclei)",
    "Mozilla/5.0 zgrab/0.x",
  ]) {
    assert.ok(DEFAULT_BOT_UA_PATTERN.test(ua), `expected match for: ${ua}`);
  }
});

test("DEFAULT_BOT_UA_PATTERN does NOT match real Flux API client UAs", () => {
  for (const ua of [
    "curl/8.6.0",
    "axios/1.7.7",
    "node-fetch/3.3.2",
    "Go-http-client/1.1",
    "python-requests/2.32.3",
    "PostmanRuntime/7.39.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Bun/1.1.42",
    "Deno/1.46.0",
    "@flux/sdk/0.1.0",
    "",
  ]) {
    assert.equal(
      DEFAULT_BOT_UA_PATTERN.test(ua),
      false,
      `expected NO match for: ${JSON.stringify(ua)}`,
    );
  }
});

test("botFilterMiddleware: disabled is a pure pass-through", async () => {
  const app = appWithFilter({ enabled: false });

  const res = await app.request("http://api.example.test/items", {
    headers: { "user-agent": "MJ12bot/v1.4.8" },
  });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "FELL_THROUGH");
});

test("botFilterMiddleware: enabled blocks default pattern with 403", async () => {
  const app = appWithFilter({ enabled: true });

  const res = await app.request("http://api.example.test/items", {
    headers: { "user-agent": "Mozilla/5.0 (compatible; AhrefsBot/7.0)" },
  });
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "forbidden");
});

test("botFilterMiddleware: enabled lets real client UAs through", async () => {
  const app = appWithFilter({ enabled: true });

  for (const ua of ["curl/8.6.0", "axios/1.7.7", "Go-http-client/1.1", ""]) {
    const res = await app.request("http://api.example.test/items", {
      headers: ua ? { "user-agent": ua } : {},
    });
    assert.equal(res.status, 200, `expected 200 for ua: ${JSON.stringify(ua)}`);
  }
});

test("botFilterMiddleware: custom pattern REPLACES the default", async () => {
  // With a narrow custom pattern, AhrefsBot (in default list) should pass,
  // and only "BlockMe" should be blocked.
  const app = appWithFilter({ enabled: true, pattern: "BlockMe" });

  const ahrefs = await app.request("http://api.example.test/items", {
    headers: { "user-agent": "AhrefsBot/7.0" },
  });
  assert.equal(ahrefs.status, 200);

  const blocked = await app.request("http://api.example.test/items", {
    headers: { "user-agent": "Mozilla/5.0 BlockMe/1.0" },
  });
  assert.equal(blocked.status, 403);
});

test("botFilterMiddleware: invalid regex fails open (no blocking, no crash)", async () => {
  // Unbalanced bracket — invalid regex.  Filter must fall back to pass-through.
  const app = appWithFilter({ enabled: true, pattern: "[invalid(" });

  const res = await app.request("http://api.example.test/items", {
    headers: { "user-agent": "MJ12bot/v1.4.8" },
  });
  assert.equal(res.status, 200);
});

test("botFilterMiddleware: empty UA is not blocked", async () => {
  // Some legitimate clients omit the UA entirely; we must not 403 them.
  const app = appWithFilter({ enabled: true });

  const res = await app.request("http://api.example.test/items");
  assert.equal(res.status, 200);
});
