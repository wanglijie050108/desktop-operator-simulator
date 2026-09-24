---
name: "human-operation-simulator-guardrails"
description: "Enforces architecture, quality, safety, cross-platform testing, and changelog rules. Invoke for any analysis, edit, test, debugging, integration, or operation in this repository."
---

# Human Operation Simulator Guardrails

Use this Skill for every repository task, including analysis, planning, code or
documentation changes, configuration, debugging, tests, integration, deployment,
and environment operations.

## 1. Canonical Sources

Treat these files as authoritative:

1. `docs/01-requirements-and-scope.md`: product goals, MVP boundary, and prohibited behavior.
2. `docs/02-system-architecture.md`: component ownership, workflow, safety, and deployment.
3. `docs/03-contracts-and-data.md`: HTTP/WebSocket contracts, entities, errors, and retention.
4. `docs/04-implementation-plan.md`: milestones, task order, and Definition of Done.
5. `docs/05-testing-and-acceptance.md`: required test layers and acceptance targets.
6. `docs/06-decisions-and-risks.md`: accepted technical decisions and stop conditions.
7. `docs/07-windows-test-environment.md`: Windows setup and real UI validation requirements.
8. `contracts/openapi.yaml`: machine-readable HTTP API contract.
9. `docs/08-development-status.md`: current implemented, pending, and unverified work.
10. `changelog/README.md`: mandatory work-record format.
11. The newest relevant entry under `changelog/`: recent decisions, attempts, and limitations.
12. `README.md`: current repository state and supported commands.

Do not create a second independent specification. If implementation and
documentation disagree, identify whether the requested work intentionally changes
the architecture. Otherwise, conform the implementation to the canonical documents.
Update every affected canonical document when a contract or architectural decision
changes.

## 2. Mandatory Start Procedure

Before analysis or modification:

1. Locate the repository root with `git rev-parse --show-toplevel`.
2. Read `README.md`, `docs/08-development-status.md`, `changelog/README.md`, and
   the newest relevant changelog entry.
3. Read the canonical documents relevant to the task. For architecture, security,
   cross-component, or environment work, read all affected documents completely.
4. Run `git status --short --branch`.
5. Inspect existing code, tests, scripts, and configuration before proposing changes.
6. Preserve unrelated user changes and generated local data.
7. Create or select the task changelog entry before the first repository modification.

Do not assume that a clean environment, dependency, Windows host, account, or
interactive desktop session exists. Verify it or record it as unavailable.

## 3. Fixed Architecture and Ownership

- The Windows Desktop Agent uses C# 14 and .NET 10.
- The Control Server, browser adapters, and shared Node tooling use Node.js 24 LTS
  and TypeScript.
- The Operator Web uses Vue 3, Vite, and Pinia.
- Browser automation uses Playwright.
- The local database uses SQLite.
- The Control Server is the task, workflow, policy, and persistence source of truth.
- The Desktop Agent owns Windows UI Automation, foreground-window checks, input,
  clipboard, screenshots, and emergency input release.
- Browser adapters own site selectors and browser interaction.
- Workflows may call adapters but must not contain UIA, DOM, or coordinate selectors.
- Desktop commands and events use strict, versioned DTOs. Never add arbitrary script,
  shell, file-path, or JavaScript execution.

Keep cross-platform code separate from Windows-only code:

- Put contracts, validation, state transitions, and other pure logic in
  cross-platform projects or packages.
- Isolate FlaUI, Windows APIs, clipboard, `SendInput`, window handles, and real
  application adapters in Windows-targeted projects.
- Provide fakes for Control Server development, CI, and integration tests whenever
  a real interactive Windows desktop is unavailable.
- Do not weaken Windows behavior merely to make a Windows-only adapter run on a
  non-Windows host.

## 4. Safety and Privacy Boundaries

Never implement payment, transfer, order confirmation, credential or cookie
extraction, CAPTCHA bypass, anti-bot bypass, arbitrary command execution, or
unrestricted filesystem/network actions.

Require:

- Trusted-sender and command-prefix checks before task creation.
- Deterministic workflows and allowlisted action types.
- Policy checks in both Control Server and Desktop Agent.
- Foreground process/window validation before desktop input.
- Expiring, idempotent commands and duplicate-message protection.
- Explicit `WAITING_FOR_HUMAN` behavior for login and CAPTCHA.
- Sanitized logs, screenshots, traces, identifiers, and errors.
- Dedicated test accounts without payment data.

Never commit secrets, credentials, cookies, personal chat content, databases,
screenshots, traces, browser profiles, or other runtime artifacts.

## 5. Engineering Quality Rules

- Prefer existing repository patterns and the simplest implementation satisfying the
  documented architecture.
- Keep handlers and transport layers thin; put policy and workflow behavior in
  application/domain modules.
- Use strict TypeScript and nullable-aware C#.
- Use stable enums, error codes, UUIDs, and UTC ISO 8601 timestamps.
- Validate data at process and trust boundaries.
- Keep selectors inside versioned adapters.
- Use semantic UIA and Playwright locators before anchored coordinates. Fixed
  coordinates are PoC-only and require window, resolution, and DPI checks.
- Do not silently swallow failures or retry non-idempotent actions.
- Add dependencies only when justified; lock exact resolved versions.
- Keep changes focused. Do not mix unrelated refactors into a task.
- Update OpenAPI, DTOs, schemas, serializers, and contract tests together.
- Comments should explain non-obvious constraints, not restate code.

## 6. Testing and Environment Matrix

Scale tests with the change and use repository scripts once they exist.

Required layers as applicable:

- Unit tests for parsers, state transitions, policy, ranking, redaction, and
  idempotency.
- Contract tests proving Node and C# agree on message versions, enums, UUIDs, and
  timestamps.
- Adapter tests against synthetic local fixtures.
- Integration tests with Control Server, temporary SQLite, fake Desktop Agent, and
  local browser fixtures.
- Real Windows smoke/E2E tests for FlaUI, WeChat, input, clipboard, screenshots, and
  the complete workflow.

Do not assume a permanent primary development operating system. Determine the
current host and available test targets at task start:

- A Windows development host may perform the full development workflow, including
  Windows-targeted builds and real desktop validation when an unlocked interactive
  session and dedicated test applications/accounts are available.
- macOS or Linux may build and test cross-platform .NET code, Node services,
  Playwright browser logic, Vue, contracts, and fake-agent integration.
- Real FlaUI, WeChat, input, clipboard, screenshot, and complete desktop workflow
  validation always requires the documented Windows environment, regardless of
  which operating system is used for most coding.

Do not report a task as fully validated when its required Windows check was not
executed.

Record every validation command as `PASSED`, `FAILED`, `NOT_EXECUTED`, or `BLOCKED`,
with a concise reason. Report unresolved warnings.

## 7. Development Status Maintenance

`docs/08-development-status.md` is the repository-wide factual progress summary.
It complements the implementation plan and changelog; it does not replace either.

For every task that implements, removes, validates, invalidates, or materially
changes a planned capability:

1. Read the status document before implementation.
2. Update it in the same task before completion.
3. Mark only evidence-backed work as completed. Code existence alone does not prove
   real integration or acceptance.
4. Distinguish code implementation, fake/fixture validation, local process
   validation, and real Windows/external-system validation.
5. Keep unavailable or unexecuted environment checks explicitly unverified.
6. Update the document date and preserve pending items; do not hide unfinished work
   by deleting it.
7. Reconcile the status document with the actual diff, tests, changelog, and
   milestone exit criteria during completion review.

Documentation-only tasks that do not change project capability or validation state
may leave the status document unchanged.

## 8. Mandatory Changelog Workflow

Every AI task that analyzes or operates on this repository must have a Markdown entry
under `changelog/`, including read-only analysis, failed investigations,
documentation changes, implementation, debugging, tests, integration, environment
setup, deployment, and rollback.

1. Use one logical file named `YYYY-MM-DD-short-topic.md`.
2. Add `-2`, `-3`, and so on if that name already exists for a separate task.
3. Create the entry at task start and update it after each meaningful operation.
4. Record objective, context, evidence inspected, concise analysis and decisions,
   operations, files changed, validation results, failures and resolutions, risks,
   limitations, and final outcome.
5. Record facts and decision rationale sufficient for another assistant to continue.
   Do not store hidden chain-of-thought, speculative internal monologue, or raw
   command transcripts.
6. Mark planned but unexecuted work explicitly. Never claim a command or real
   Windows check ran when it did not.
7. Redact secrets, tokens, cookies, personal data, real chat content, and sensitive
   local paths or logs.
8. Update the same entry through the task instead of creating fragmented logs.
9. Before completion, compare the entry with the actual diff and test results.

Follow the exact template and status vocabulary in `changelog/README.md`.

## 9. Git and Delivery Rules

- Never discard or overwrite unrelated changes.
- Inspect diffs before and after editing.
- Stage explicit paths only.
- Do not commit, amend, push, merge, or delete branches unless the user asks.
- Never bypass hooks.
- Prefer a new commit over amending.
- Do not report completion while required commands are still running.

## 10. Completion Review

Before responding that work is complete:

1. Re-read the user request and inspect the final diff.
2. Verify architecture, contracts, safety, privacy, and platform boundaries.
3. Confirm focused tests cover normal, failure, timeout/cancel, and idempotency paths
   relevant to the change.
4. Run available formatting, lint, type-check, build, and test commands.
5. Run integration or real Windows checks when required and available.
6. Update documentation and contracts affected by behavior changes.
7. Update `docs/08-development-status.md` when capability or validation state changed.
8. Finalize the changelog entry with exact validation status and known limitations.
9. Run `git status --short --branch` and report any uncommitted files accurately.

The task is not complete if required evidence is missing. State the gap plainly and
leave reproducible next steps in the changelog.
