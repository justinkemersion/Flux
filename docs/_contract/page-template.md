# docs/_contract/page-template.md

# Flux Docs Page Template

Every user-facing docs page should have a clear job.

A page should not exist because a command, component, or legacy route exists.

## Required page shape

Each page should answer:

1. What is this page about?
2. Who is it for?
3. What should the reader understand after reading it?
4. What is the minimum concept needed before details?
5. What is the practical next step?

## Default structure

```md
# Page Title

One short paragraph explaining the purpose of the page.

## What you will learn

- Outcome 1
- Outcome 2
- Outcome 3

## The idea

Explain the concept plainly before commands or code.

## How it works

Add technical depth progressively.

## Example

Show the smallest useful example.

## Next steps

Link to the next conceptual or practical page.

Page rules
Start with the concept

Do not start with flags, env vars, or implementation details unless the page is in /reference.

Keep examples small

A page should usually have one primary example.

Avoid duplicating architecture

Guides may recap architecture briefly, but should link to canonical architecture pages.

Make tradeoffs explicit

If a choice exists, explain when to choose each option.

Keep reference material out of guides

Guides should teach workflows.
Reference pages should list exhaustive options.

Page categories
Introduction pages

Goal: reduce confusion and establish the mental model.

Should be light on commands.

Getting Started pages

Goal: get the reader to a working project.

Should be linear and copy-pasteable.

Concept pages

Goal: define durable ideas.

Should answer “what is this and why does it matter?”

Architecture pages

Goal: explain trust boundaries and internal mechanics.

Should be precise and diagram-friendly.

Guide pages

Goal: solve a real implementation problem.

Should assume the reader has seen the mental model.

Reference pages

Goal: support returning users.

Can include tables, flags, env vars, and complete command listings.