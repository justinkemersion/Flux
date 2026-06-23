import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildFluxMdGenerationPrompt,
  FLUX_MD_FILENAME,
  FLUX_MD_MAX_LEN,
  FLUX_MD_TEMPLATE,
  FluxMdValidationError,
  normalizeFluxMdContent,
} from "./flux-md.ts";

describe("flux-md", () => {
  test("normalizeFluxMdContent trims and rejects empty", () => {
    assert.equal(normalizeFluxMdContent("  hello  "), "hello");
    assert.equal(normalizeFluxMdContent(""), null);
    assert.equal(normalizeFluxMdContent(null), null);
  });

  test("normalizeFluxMdContent enforces max length", () => {
    assert.throws(
      () => normalizeFluxMdContent("x".repeat(FLUX_MD_MAX_LEN + 1)),
      FluxMdValidationError,
    );
  });

  test("buildFluxMdGenerationPrompt includes project context and template", () => {
    const prompt = buildFluxMdGenerationPrompt({
      name: "Demo App",
      slug: "demo",
      hash: "abc1234",
    });
    assert.match(prompt, /Demo App/);
    assert.match(prompt, /`demo`/);
    assert.match(prompt, /abc1234/);
    assert.match(prompt, new RegExp(FLUX_MD_FILENAME));
    assert.match(prompt, /## Purpose/);
    assert.match(prompt, /# Flux Project Brief/);
    assert.match(prompt, /flux project brief push/);
  });
});
