# Flux Frontmatter Contract

Every user-facing documentation page in `docs/pages/` must include frontmatter.

Frontmatter exists to define:

- document identity
- ordering
- navigation relationships
- summary metadata
- disclosure hierarchy

Frontmatter should NOT define:

- visual styling
- layout behavior
- rendering mechanics
- component selection
- arbitrary UI flags

Flux documentation remains content-first.

---

# Required Fields

Every page must include:

```yaml
---
title:
description:
section:
order:
---