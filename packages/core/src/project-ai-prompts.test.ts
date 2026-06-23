import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildBriefGenerationUserPrompt,
  buildProjectAiUserPrompt,
  type ProjectAiContext,
} from "./project-ai-prompts.ts";

const BASE_CTX: ProjectAiContext = {
  slug: "demo",
  hash: "abc1234",
  name: "Demo App",
  mode: "v2_shared",
  description: "Photo app",
  operatorBrief: null,
  lifecycleState: "active",
  existingFluxMd: null,
  apiSchema: "t_abc_api",
  schemaSummary: {
    tableCount: 1,
    tables: [
      {
        name: "photos",
        rowCount: 12,
        rlsEnabled: true,
        columns: ["id", "user_id", "url"],
      },
    ],
  },
  schemaNote: null,
  recentActivity: [],
  appliedMigrationCount: 2,
  backupTrustSummary: "Latest backup is restorable.",
};

describe("project-ai-prompts", () => {
  test("brief prompt includes template and context", () => {
    const prompt = buildBriefGenerationUserPrompt(BASE_CTX);
    assert.match(prompt, /FLUX\.md/);
    assert.match(prompt, /## Purpose/);
    assert.match(prompt, /"slug": "demo"/);
    assert.match(prompt, /photos/);
  });

  test("buildProjectAiUserPrompt routes kinds", () => {
    assert.match(buildProjectAiUserPrompt("activity", BASE_CTX), /Summarize/);
    assert.match(buildProjectAiUserPrompt("resume", BASE_CTX), /resuming work/);
  });
});
