---
title: Service URLs
description: Canonical API hostnames for Flux projects—including flattened v2 URLs and legacy dotted forms.
section: concepts
---

# Service URLs

The **Service URL** is the public origin your application calls for PostgREST-shaped HTTP. On v2, the canonical external hostname is often **flattened** with double dashes around the slug; older deployments may still show **dotted** hostnames.

## What you will learn

- Canonical vs legacy host patterns
- Why `flux list` / dashboard are source of truth
- What to do when debugging TLS or CA issues

## The idea

Trust the URL printed by **`flux list`** or the dashboard for new work. Both flattened and legacy names may route at Traefik during transitions, but your client config should follow the canonical string to avoid subtle env drift.

Example flattened pattern:

```txt
https://api--<slug>--<hash>.<base-domain>
```

Legacy dotted pattern (illustrative):

```txt
https://api.<slug>.<hash>.<base-domain>
```

## How it works

- Applications use HTTPS with `Authorization: Bearer …` on v2 pooled.
- Node or serverless clients must trust the TLS chain (`NODE_EXTRA_CA_CERTS` for private CAs)—see [Production hardening](/docs/guides/production-hardening).

## Example

```bash
flux list
# copy Service URL into NEXT_PUBLIC_FLUX_URL or server-side FLUX_URL
```

## Next steps

- [First request](/docs/getting-started/first-request)
- [JWT authentication](/docs/concepts/jwt-auth)
