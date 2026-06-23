import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeProjectMetadata,
  normalizeProjectMetadataPatch,
  ProjectMetadataValidationError,
  PROJECT_DESCRIPTION_MAX_LEN,
} from "./project-metadata.ts";

test("normalizeProjectMetadataPatch trims and empty-to-null", () => {
  const out = normalizeProjectMetadataPatch({
    description: "  Home inventory  ",
    brief: "",
  });
  assert.equal(out.description, "Home inventory");
  assert.equal(out.brief, null);
});

test("normalizeProjectMetadataPatch rejects long description", () => {
  assert.throws(
    () =>
      normalizeProjectMetadataPatch({
        description: "x".repeat(PROJECT_DESCRIPTION_MAX_LEN + 1),
      }),
    ProjectMetadataValidationError,
  );
});

test("mergeProjectMetadata updates only provided keys", () => {
  const merged = mergeProjectMetadata(
    { description: "old", brief: "notes" },
    { description: "new" },
  );
  assert.equal(merged.description, "new");
  assert.equal(merged.brief, "notes");
});
