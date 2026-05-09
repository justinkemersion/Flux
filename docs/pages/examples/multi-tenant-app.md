---
title: Multi-tenant app example
description: Patterns for tenant data isolation with RLS and JWT claims.
section: examples
---

# Multi-tenant app example

A **multi-tenant** SaaS on Flux typically combines:

- A **tenant_id** or org identifier in your tables
- JWT claims (`sub`, org id) referenced by **RLS** policies
- Careful **GRANT** setup for the PostgREST role

## What you will learn

- Baseline schema shape
- Policy sketch
- Pitfalls (missing grants, type drift)

## The idea

RLS is optional but powerful: every query automatically filters rows for the current principal. You still need correct privileges—see [RLS boundaries](/docs/security/rls-boundaries).

## How it works

```sql
ALTER TABLE t_shortid_api.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_tenant_isolation ON t_shortid_api.orders
  FOR ALL TO authenticated
  USING (tenant_id = current_setting('request.jwt.claims', true)::json->>'org_id')
  WITH CHECK (tenant_id = current_setting('request.jwt.claims', true)::json->>'org_id');
```

Adapt claim names to your IdP.

## Example

Integration tests should use real JWT shapes, not only superuser SQL sessions—otherwise policies drift from production.

## Next steps

- [Row-level security](/docs/concepts/rls)
- [Auth.js guide](/docs/guides/authjs)
