1. Flux-managed backups

For every project, Flux should own automatic backups as part of the platform promise.

v1 dedicated projects

Best target:

Nightly logical backup

pg_dump -Fc --no-owner --no-acl ...

Stored as:

/backups/v1/<project_id>/<yyyy-mm-dd>.dump

Later: push to S3/R2/Backblaze/Hetzner Storage Box.

Then add PITR/WAL archiving for Pro once Flux is more mature. PostgreSQL’s official PITR model depends on base backups plus continuous WAL archiving.

v2 shared projects

More delicate.

You need:

Cluster-level physical backups
For disaster recovery of the whole shared Postgres.

Plus:

Per-tenant logical exports

pg_dump -Fc \
  --schema=t_<shortid>_api \
  --schema=auth_or_project_metadata_if_needed

This is what gives each Standard/Free user a portable “their project only” backup.

2. User-owned exports

Yes, this is industry-standard-ish. Supabase, for example, exposes dashboard backups and also documents logical backups through CLI dumping.

Flux should encourage:

flux backup create
flux backup download
flux backup restore

And docs should say:

Flux maintains platform backups, but you should periodically export your own backups before major migrations, launches, destructive schema changes, or business-critical releases.

That wording is important. Not scary, just mature.

The product shape I’d build
CLI
flux backup create --project bloom
flux backup list --project bloom
flux backup download --project bloom --latest
flux backup restore --project bloom ./backup.dump

For v2 shared:

flux backup create --project bloom

internally dumps only:

t_<shortid>_api

Never the whole shared cluster.

Dashboard

Project page card:

Backups

Last automatic backup: 2026-05-08 03:00
Retention: 7 days / 30 days / 90 days depending tier
Button: “Download backup”
Button: “Create backup now”
Warning near destructive actions: “Create backup before reset/delete/migrate”
Tiering

I’d do (currently we only support "free" and "Pro+"):

Tier	Automatic backups	User exports
Free	best-effort / maybe 1 daily, short retention	manual export
Standard	daily, 7–14 days	manual export
Pro v1	daily, 30 days	manual export
Pro+ later	PITR	manual export
Very important Flux rule

Do not promise “fully backed up” until restore is tested.

A backup system is not:

cron + pg_dump

A backup system is:

cron + dump + offsite storage + checksum + restore test + alerting
MVP implementation

Start with this:

Add flux backup create.
Use pg_dump -Fc, because PostgreSQL custom format is compressed and designed for pg_restore.
Save local backups under /srv/flux/backups.
Add backup metadata table in Flux system DB.
Add nightly cron/systemd timer.
Add restore test script against a disposable Postgres container.
Add dashboard “Download latest backup.”
Later add Hetzner Storage Box / Backblaze B2 / Cloudflare R2 offsite copy.
My strong opinion

For Flux, backups should become part of the brand:

“Flux is boring where it matters: migrations, auth boundaries, and backups.”