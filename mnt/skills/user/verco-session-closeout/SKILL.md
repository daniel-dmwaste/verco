# Verco Session Close-Out

Closes out a Verco dev session by committing work, triaging session learnings into the right destination, and updating CLAUDE.md + the session log without bloating either.

The canonical version is at `.claude/commands/session-closeout.md` — that's the file the slash command runs. Keep this file in sync.

When this skill triggers, DO NOT output a prompt for the user to paste. Execute these steps directly.

---

## Step 1 — Commit and push uncommitted work

```bash
git status
```

If the working tree is clean, skip to Step 2. Otherwise:

1. Identify the session topic in 3–5 words from the conversation (not from the diff).
2. Stage files **explicitly by name** — never `git add -A` or `git add .` (avoids committing `.env*`, secrets, or stray files).
3. Commit with conventional commit format via heredoc.
4. **Never push to `main` without asking first.** Feature branches push freely.
5. `git push` (with `-u origin <branch>` on first push).

---

## Step 2 — Review what was built

```bash
git log --oneline --since="10 hours ago"
git diff --stat HEAD~5..HEAD
```

Identify everything new since the start of the session: schema changes, new Edge Functions, new patterns used, bugs fixed, conventions established, scope decisions made, work deferred.

---

## Step 3 — Triage each session learning into ONE bucket

### A — Durable rule → CLAUDE.md core sections (§1–§21)

Rules future sessions need at startup. Examples: schema facts, bugs whose root cause implies a rule, repeated patterns worth standardising, new Red Lines.

- Add to the **most relevant existing section** in §1–§21. Do NOT create a new section.
- One line per rule wherever possible. Tighten ruthlessly.
- If the rule already exists, update in place; don't add a duplicate.

### B — Session context → `~/.claude/memory/verco/session-log.md`

Useful context but not load-bearing rules. Examples: reasoning behind a decision, scope reversals, recovery procedures, branch state, tech debt found.

- Append a dated section. Verbose is fine.
- Cross-reference commit hashes.
- Not in git — Dan's local memory.

### C — Inventory → NOWHERE

Derivable from the filesystem and must NOT be added to CLAUDE.md OR the session log:

- Lists of Edge Functions / migrations / admin pages / test files
- Branch state at end of session
- File-by-file diff summaries
- Commit summaries

If you find inventory in the existing CLAUDE.md, **delete it** as part of closeout.

### D — Pending work / follow-ups → Linear (or surface to Dan)

Work items, not rules. Do NOT add to CLAUDE.md — they go stale and clutter the file. Surface to Dan in the closeout summary so he can create Linear tickets.

### E — Code blocks duplicating repo files → NOWHERE

Reference the file by path. Claude can `Read` it when needed.

---

## Step 4 — Apply CLAUDE.md updates with hard guardrails

**Hard rules:**

1. **Target ≤ 400 lines.** Run `wc -l CLAUDE.md`. If over 450 after edits, trim before committing.
2. **Never create a "Session Decisions — [date]" section.** §22–§28 anti-pattern. Promote to §1–§21.
3. **Never add inventory tables.**
4. **Never paste code blocks duplicating repo files.**
5. **Never add work items / audit gaps / pending steps.**
6. **Never duplicate an existing rule.** Update in place.
7. **One line per rule** where possible.

Acceptable range after edits: 380–450 lines.

---

## Step 5 — Append session context to session log

Edit `~/.claude/memory/verco/session-log.md` and append a dated section in the existing format. Verbose is fine. Cross-reference commit hashes.

---

## Step 6 — Update obsidian wiki if scope or architecture changed

Only when the session involved a project with a brief or tech plan in `~/obsidian/Claude/wiki/projects/` AND the work changed scope or invalidated assumptions. Skip for pure feature work.

---

## Step 7 — Commit CLAUDE.md (if modified) and verify

```bash
wc -l CLAUDE.md   # MUST be ≤ 450
git add CLAUDE.md
git commit -m "chore: update CLAUDE.md with session decisions — [topic]"
git push
```

The session log file at `~/.claude/memory/verco/` is NOT in git — no commit step for that.

---

## Step 8 — Final summary to Dan

4-line summary:

1. **Branch state**: N commits ahead, pushed status, PR URL
2. **Tests**: X/Y green
3. **CLAUDE.md**: N lines (target ≤ 400)
4. **Outstanding for Dan**: any category D items, or decisions needing his eyes

Brief. Dan is closing the laptop.

---

## Reference: lessons from the 8 April 2026 audit

The §22–§28 anti-pattern: from 27 March to 8 April, every closeout added a new "Session Decisions — [date]" section with inventory tables and verbose decision context. This grew CLAUDE.md from 478 to 1172 lines in 12 days, duplicating what was already in the filesystem and the session log.

The 8 April audit deleted ~770 lines (62% reduction), promoted durable rules into §1–§21, and established the triage above. **This skill exists to prevent that pattern from recurring.** If you find yourself wanting to write "## Session Decisions — [date]" in CLAUDE.md, stop and re-read Step 3.
