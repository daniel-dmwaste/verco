---
name: verco-session-closeout
description: Use this skill to close out any Verco development session. Triggers when Dan says "that will do", "close out the session", "wrap up", "end the session", "we're done", "call it a day", "update claude.md", or any end-of-session phrase. Also trigger when Dan asks for a closing prompt, session review, or CLAUDE.md update at the end of a working session. Always use this skill — never generate a closeout prompt without it.
---

# Verco Session Close-Out

Closes out a Verco dev session by committing work and updating CLAUDE.md.

## Instructions

When this skill triggers, DO NOT output a prompt for the user to paste. Execute these steps directly:

### Step 1 — Commit uncommitted work
Read the conversation to identify session topics (3–5 words). Then run:
git add -A
git commit -m "feat: [session topics]"
git push

### Step 2 — Review what was built
Run: git log --oneline --since="8 hours ago"
Scan the modified files to understand what changed this session.

### Step 2.5 — Sync Linear before logging

For every Linear ticket ID referenced in this session's commits, branch names, or PR titles, verify Linear state matches what shipped:

- **PR merged → set state Done** via `mcp__linear__save_issue`. Attach the PR via the `links` param.
- **Ticket triaged out / superseded → set Duplicate or Cancelled** with a one-line `save_comment` explaining why.
- **In-progress at session end → leave Open.** Do NOT write "pending next session" in CLAUDE.md or memory files — the ticket is source of truth.

If a ticket's state is ambiguous (touched but no clear completion signal), surface to Dan rather than guessing.

Refuse to proceed to Step 3 until any drift is resolved. The whole point: the next `/startup` against Linear sees ground truth, not yesterday's lag.

**Why this exists:** on 2026-05-15 the startup discovered VER-199 was actually Done (resolved by PR #32 on 14/05) but Linear still showed Backlog. The PR shipped 24 hours earlier — this sync step would have flushed state at session close. Same morning surfaced VER-202/203 as "open" in the brief when they were Duplicates closed the night before. Push consistency at write-time, not at read-time.

### Step 3 — Update CLAUDE.md (400-line hard cap)

**Before adding anything, triage into three buckets:**
- **A) Durable rules** that prevent recurring mistakes → add to CLAUDE.md §21
- **B) Operational context** (what was built, how it works, implementation details) → add to memory files
- **C) One-time fixes, inventories, code-level details → nowhere**

**Removal check (do this FIRST):**
Scan §21 Patterns & Gotchas for items that are now:
- Obvious from the code (the fix landed, the pattern is established)
- Duplicated in core sections (§6 pricing, §7 state machine, §12 RLS)
- Implementation descriptions rather than rules to follow
Remove those before adding new items.

**Then add new items.** Look for:
- Any pattern used more than once that should become a convention
- Any fix that reveals a recurring mistake to avoid in future
- Any schema, naming, or RLS decisions made

**Hard cap: CLAUDE.md must stay under 400 lines.** If over after edits, compress or move items to memory until under.

Do NOT add:
- Anything already in CLAUDE.md
- One-off fixes that aren't a general pattern
- UI copy changes or implementation descriptions
- General programming knowledge (e.g. Postgres gotchas)

One line per decision where possible.

### Step 4 — Commit CLAUDE.md
git add CLAUDE.md
git commit -m "chore: update CLAUDE.md with session decisions — [session topics]"
git push
