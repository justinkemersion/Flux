Now that the trust model is solid, this becomes mostly an operational design problem rather than a product design problem.

I’d keep the next phase intentionally boring.

# What Flux now has

You already built:

```txt
create
verify
download
trust classification
reconciliation
v1 + v2 support
restore verification
```

That is the hard part.

Now the question is:

```txt
Where do artifacts live?
For how long?
When are they deleted?
```

---

# My recommendation

## Storage strategy

### Primary

Keep:

```txt
local Docker volume
```

because:

* fastest access
* easiest verify/download
* simplest operationally

### Secondary (real offsite)

Add:

## Backblaze B2

Why I still recommend it:

* extremely cheap
* durable
* simple S3-compatible API
* operationally boring
* independent from your infra
* good fit for append-only backup artifacts

You already abstracted storage well enough that this should mostly become:

```txt
FilesystemStorage
→ B2Storage
```

later maybe:

```txt
R2Storage
S3Storage
HetznerStorageBox
```

---

# The exact retention model I would ship

Do not overcomplicate this.

## Free

```txt
manual only
retain last 3
```

## Standard (v2_shared)

```txt
daily
retain 7 days
```

## Pro (v1_dedicated)

```txt
daily
retain 30 days
```

Later:

```txt
weekly long-term snapshots
monthly archival
```

But not now.

---

# Important architecture rule

Retention should delete:

```txt
metadata row
AND
local artifact
AND
offsite artifact
```

atomically-ish.

Meaning:

```txt
delete lifecycle is orchestrated from the catalog row
```

not from random filesystem sweeps.

---

# Add these fields now

I would add:

```sql
retention_class text
expires_at timestamptz
offsite_replication_status text
offsite_replicated_at timestamptz
offsite_storage_key text
```

Even if some are null initially.

Because eventually you will want:

```txt
local artifact missing
but offsite still valid
```

which is a real-world state.

---

# The scheduler evolution

Current:

```txt
nightly backup create
```

Next:

```txt
nightly create
→ verify
→ replicate offsite
→ reconcile
→ retention sweep
```

in that order.

That sequence matters.

Never delete old backups before new backup verify succeeds.

---

# One thing I would add immediately

A distinct trust nuance:

```txt
restore_verified
```

is different from:

```txt
offsite_replicated
```

Example:

| State              | Meaning                   |
| ------------------ | ------------------------- |
| restore_verified   | backup is usable          |
| offsite_replicated | backup survives host loss |

Those are different operational guarantees.

---

# UI copy I would eventually expose

```txt
Latest backup:
✓ Restore verified
✓ Offsite replicated
✓ Artifact validated
```

This is the kind of boring transparency that advanced users love.

---

# My exact implementation order

## Phase 1

Backblaze B2 upload after successful verify.

## Phase 2

Retention sweeper.

## Phase 3

Restore download fallback:

```txt
local missing → stream from offsite
```

## Phase 4

Periodic reconciliation against offsite.

## Phase 5

Optional customer-facing retention controls.

---

# One critical philosophical point

Flux should never imply:

```txt
"We guarantee your business continuity."
```

Instead:

```txt
"Flux provides verified and replicated backup infrastructure."
```

Subtle difference, but important.
