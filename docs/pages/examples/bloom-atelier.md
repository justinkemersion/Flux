---
title: Bloom Atelier example
description: A realistic slug and hostname pattern used across Flux tests and docs.
section: examples
---

# Bloom Atelier example

**Bloom Atelier** is a canonical sample slug in Flux tests: it exercises **flattened** Service URL parsing (`api--bloom-atelier--<hash>.…`) and legacy dotted hosts.

## What you will learn

- How flattened hosts encode slug + hash
- Why tests use this string
- How to apply the pattern to your project

## The idea

Flux distinguishes **user-facing slug** from orchestrator-assigned **hash** segments. URLs interleave them with double dashes for the flattened form—your real project will follow the same structural rules with different values from `flux list`.

## How it works

Example host (illustrative hash):

```txt
https://api--bloom-atelier--61d9dff.example.com
```

SDK and gateway tests assert parsers recover `bloom-atelier` and hash segments consistently.

## Example

When writing client URL helpers, test both flattened and any legacy dotted forms your deployment still accepts during migration.

## Next steps

- [Service URLs](/docs/concepts/service-urls)
- [Pooled → dedicated migrate](/docs/guides/v2-to-v1-migrate)
- [Simple CRUD](/docs/examples/simple-crud)
