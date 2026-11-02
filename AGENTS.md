# AI Agent Instructions

Before analyzing, modifying, testing, debugging, integrating, configuring, or
operating this repository, read and follow (all mandatory for every repository task):

```text
.trae/skills/product-target/SKILL.md
.trae/skills/human-operation-simulator-guardrails/SKILL.md
```

`product-target` freezes the course-design product goal (remote shopping command →
agent PC consults AI → completes product search → returns best result) and is the
north-star requirement. `human-operation-simulator-guardrails` enforces architecture,
quality, safety, and the mandatory `changelog/` record: before committing, write one
entry recording what was analyzed and concluded, what was actually changed, and the
exact validation status. Do not rewrite the entry after every step; keep it dense
rather than a step-by-step operations log.

When instructions conflict, follow the user's latest explicit request, then this
file and the repository Skills (`product-target`, then `human-operation-simulator-guardrails`),
then the canonical documents listed by the Skills.
