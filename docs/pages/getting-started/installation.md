---
title: Installation
description: Install the Flux CLI, set environment variables, and verify login.
section: getting-started
---

# Installation

You need **Node.js 20+** and **curl** for the hosted installer. The CLI talks to the Flux **control plane API** using an API token you create in the dashboard.

## What you will learn

- How to install `flux` on Linux/macOS
- Which environment variables the CLI expects
- How to confirm authentication

## The idea

The CLI is the primary operator surface for **create**, **push**, **list**, lifecycle, and dumps. It is not a replacement for reading how **engines** and **Service URLs** work—but you need it on your machine before the rest of the getting-started path is meaningful.

## How it works

1. Run the installer (default binary path `~/.local/bin`).
2. Export `FLUX_API_BASE` pointing at your dashboard origin + `/api` (no trailing slash).
3. Export `FLUX_API_TOKEN` from **Settings → API keys** in the dashboard.
4. Run `flux login` to verify.

### Install

```bash
curl -sL https://flux.vsl-base.com/install | bash

# Optional target directory:
# curl -sL https://flux.vsl-base.com/install | bash -s /usr/local/bin
```

Ensure `flux` is on your `PATH` (for example `export PATH="$HOME/.local/bin:$PATH"`).

### Environment

```bash
export FLUX_API_BASE="https://flux.vsl-base.com/api"
export FLUX_API_TOKEN="flx_live_…"
```

Self-hosted: set `FLUX_API_BASE` to **your** dashboard API origin.

### Verify

```bash
flux login
```

### Updating the CLI

The installer downloads a bundled binary from **`GET /api/install/cli`**. Re-run the installer after platform releases that add commands:

```bash
curl -sL https://flux.vsl-base.com/install | bash
flux db --help   # confirm new subcommands (e.g. db password)
```

If you develop Flux from a git checkout and **`flux`** is linked to **`packages/cli/dist/index.cjs`**, rebuild after pulling:

```bash
cd /path/to/flux
git pull
pnpm --filter @flux/cli run build
flux version --json   # expect provenanceStatus: verified
```

Forgetting the rebuild used to mean silently running the previous commit's logic. The CLI now
embeds the commit it was built from and **refuses** production-mutating commands (`push`,
`migrate`, `db-reset`, `db restore`, `nuke`, `reap`) when that commit no longer matches the
checkout. See [CLI build provenance](../../CLI-BUILD-PROVENANCE.md).

Until **`flux db password`** exists locally, v1 operators can paste the password with:

```bash
flux project credentials <slug> --hash <hash> --field postgres.password
```

## Example

```bash
flux --help
flux list
```

For commands that target an **existing** project (for example **`flux push`**), the CLI expects **`--project <slug>`** and **`--hash <7hex>`** taken from your **`flux list`** row, unless **`flux.json`** supplies them—see [Create a project](/docs/getting-started/create-project) and [Configuration](/docs/reference/config).

## Next steps

- [Create a project](/docs/getting-started/create-project)
