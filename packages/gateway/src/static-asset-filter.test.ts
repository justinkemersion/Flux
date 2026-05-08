import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { absorbStaticAssets, classifyAbsorb } from "./static-asset-filter.ts";

test("classifyAbsorb: /robots.txt is the robots verdict", () => {
  assert.deepEqual(classifyAbsorb("/robots.txt"), { kind: "robots" });
});

test("classifyAbsorb: browser-default assets get the browser_default verdict", () => {
  for (const path of [
    "/favicon.ico",
    "/apple-touch-icon.png",
    "/apple-touch-icon-precomposed.png",
    "/site.webmanifest",
    "/browserconfig.xml",
  ]) {
    assert.deepEqual(classifyAbsorb(path), { kind: "browser_default", path }, path);
  }
});

test("classifyAbsorb: scanner prefixes match", () => {
  for (const path of [
    "/.well-known/security.txt",
    "/.env",
    "/.env.local",
    "/.git/config",
    "/wp-admin/",
    "/wp-login.php",
    "/phpmyadmin/",
    "/phpMyAdmin/",
    "/server-status",
    "/xmlrpc.php",
    "/cgi-bin/luci",
    "/admin/login",
    "/administrator/index.php",
  ]) {
    assert.deepEqual(classifyAbsorb(path), { kind: "scanner_prefix" }, path);
  }
});

test("classifyAbsorb: static-asset extensions match", () => {
  for (const path of [
    "/bot-connect.js",
    "/main.css",
    "/index.html.map",
    "/robots.xml",
    "/font.woff2",
    "/logo.SVG",
    "/sitemap.txt",
    "/foo/bar/baz.png",
  ]) {
    assert.deepEqual(classifyAbsorb(path), { kind: "static_ext" }, path);
  }
});

test("classifyAbsorb: real PostgREST paths fall through (return null)", () => {
  for (const path of [
    "/",
    "/items",
    "/items?id=eq.1",
    "/rpc/my_func",
    "/rest/v1/products",
    "/auth/v1/token",
    "/very/deep/path/with/no/extension",
  ]) {
    assert.equal(classifyAbsorb(path), null, path);
  }
});

test("classifyAbsorb: 'admin' as a substring does not match (word boundary)", () => {
  // The scanner prefix is anchored at /, so "/admins-table" should fall through.
  // (We deliberately match the word boundary so '/administrator' is caught but
  // a hypothetical legitimate '/admins' table is not.)
  assert.deepEqual(classifyAbsorb("/administrator"), { kind: "scanner_prefix" });
  // /admins still trips the \b boundary because admin is followed by 's' which
  // is a word char — \b will NOT fire there.  Confirmed:
  assert.equal(classifyAbsorb("/admins"), null);
});

test("absorbStaticAssets middleware: /robots.txt → 200 text body", async () => {
  const app = new Hono();
  app.use("*", absorbStaticAssets);
  app.all("*", (c) => c.text("FELL_THROUGH", 200));

  const res = await app.request("http://api.example.test/robots.txt");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.match(res.headers.get("cache-control") ?? "", /max-age=86400/);
  const body = await res.text();
  assert.match(body, /User-agent: \*/);
  assert.match(body, /Disallow: \//);
});

test("absorbStaticAssets middleware: /favicon.ico → 204 with no body", async () => {
  const app = new Hono();
  app.use("*", absorbStaticAssets);
  app.all("*", (c) => c.text("FELL_THROUGH", 200));

  const res = await app.request("http://api.example.test/favicon.ico");
  assert.equal(res.status, 204);
  const body = await res.text();
  assert.equal(body, "");
});

test("absorbStaticAssets middleware: scanner path → 404 JSON", async () => {
  const app = new Hono();
  app.use("*", absorbStaticAssets);
  app.all("*", (c) => c.text("FELL_THROUGH", 200));

  const res = await app.request("http://api.example.test/.env");
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "not found");
});

test("absorbStaticAssets middleware: static-extension path → 404 JSON", async () => {
  const app = new Hono();
  app.use("*", absorbStaticAssets);
  app.all("*", (c) => c.text("FELL_THROUGH", 200));

  const res = await app.request("http://api.example.test/bot-connect.js");
  assert.equal(res.status, 404);
});

test("absorbStaticAssets middleware: legitimate API path falls through to next handler", async () => {
  const app = new Hono();
  app.use("*", absorbStaticAssets);
  app.all("*", (c) => c.text("FELL_THROUGH", 200));

  const res = await app.request("http://api.example.test/items?limit=1");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "FELL_THROUGH");
});
