import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatPortfolioLastActivity,
  groupProjectsForPortfolio,
  portfolioSectionForProject,
} from "./project-portfolio.ts";

test("portfolioSectionForProject normalizes lifecycle", () => {
  assert.equal(portfolioSectionForProject({ lifecycleState: "dormant" }), "dormant");
  assert.equal(portfolioSectionForProject({ lifecycleState: null }), "active");
});

test("groupProjectsForPortfolio buckets by lifecycle", () => {
  const grouped = groupProjectsForPortfolio([
    { slug: "a", lifecycleState: "active" },
    { slug: "b", lifecycleState: "dormant" },
    { slug: "c", lifecycleState: "archived" },
  ] as Array<{ slug: string; lifecycleState: string }>);
  assert.equal(grouped.active.length, 1);
  assert.equal(grouped.dormant.length, 1);
  assert.equal(grouped.archived.length, 1);
});

test("formatPortfolioLastActivity uses calendar-day buckets", () => {
  const now = new Date("2026-06-23T12:00:00.000Z");
  assert.equal(
    formatPortfolioLastActivity("2026-06-23T04:00:00.000Z", now),
    "Active today",
  );
  assert.equal(
    formatPortfolioLastActivity("2026-06-20T04:00:00.000Z", now),
    "Last active 3 days ago",
  );
});
