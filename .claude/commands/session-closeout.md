---
name: verco-session-closeout
description: Use this skill to close out any Verco development session. Triggers when Dan says "that will do", "close out the session", "wrap up", "end the session", "we're done", "call it a day", "update claude.md", or any end-of-session phrase. Also trigger when Dan asks for a closing prompt, session review, or CLAUDE.md update at the end of a working session. Always use this skill — never generate a closeout prompt without it.
---

# Verco Session Close-Out

Closes out a Verco dev session by committing work, triaging session learnings into the right destination, and updating CLAUDE.md + the session log without bloating either.

When this skill triggers, DO NOT output a prompt for the user to paste. Execute these steps directly.

---

## Step 1 — Commit and push uncommitted work

```bash
git status
```

If the working tree is clean, skip to Step 2. Otherwise:

1. Identify the session topic in 3–5 words from the conversation (not from the diff).
2. Stage files **explicitly by name** — never `git add -A` or `git add .` (avoids accidentally committing `.env*`, secrets, or unrelated stray files).
3. Commit with conventional commit format. Use the heredoc pattern so the message renders cleanly:
   ```bash
   git commit -m "$(cat <<'EOF'
   feat: [session topic]

   [optional 2-3 line summary]

   Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```
4. **Never push to `main` without asking first.** Feature branches push freely. If on `main` and uncommitted, ask Dan first.
5. `git push` (use `-u origin <branch>` on first push of a new branch).

---

## Step 2 — Review what was built

```bash
git log --oneline --since="10 hours ago"
git diff --stat HEAD~5..HEAD     # or however many commits this session produced
```

Scan the modified files to understand what changed. Identify everything new since the start of the session: schema changes, new Edge Functions, new patterns used, bugs fixed, conventions established, scope decisions made, work deferred.

---

## Step 3 — Triage each session learning

For each new thing that emerged this session, classify into ONE of these buckets:

### A — Durable rule → CLAUDE.md core sections (§1–§21)

Things that are **rules future sessions need at startup**. Examples:
- A schema fact ("`contacts.full_name` is the authoritative name")
- A bug whose root cause implies a rule ("`is_contractor_user()` includes `field` — never use it to gate PII")
- A repeated pattern worth standardising ("Server-side gate helper pattern")
- A new Red Line worth adding to §20

**Rules:**
- Add to the **most relevant existing section** in §1–§21. Do NOT create a new section.
- One line per rule wherever possible.
- Tighten ruthlessly — if it can be 15 words, don't make it 30.
- If the rule already exists in CLAUDE.md, update it in place; do not add a duplicate.

### B — Session context / decision history → `~/.claude/memory/verco/session-log.md`

Things that are **useful context but not load-bearing rules**. Examples:
- Why a decision was made (the reasoning, not the outcome)
- A scope reversal or architectural pivot mid-session
- A recovery procedure that took effort to figure out
- The state of a feature branch at end of session
- Tech debt found that wasn't fixed

**Rules:**
- Append a dated section to `~/.claude/memory/verco/session-log.md` (the file already exists — keep the format consistent with prior entries).
- Verbose is fine here. The session log is the unbounded historical record.
- Cross-reference commits by hash where useful.
- This file is NOT in git; it's in `~/.claude/memory/verco/` (Dan's local memory).

### C — Inventory → NOWHERE (do not record)

The following are derivable from the filesystem and must NOT be added to CLAUDE.md OR the session log:

- Lists of Edge Functions built (`ls supabase/functions/`)
- Lists of migrations applied (`ls supabase/migrations/`)
- Lists of admin pages built (`find src/app/(admin)`)
- Lists of test files / counts (`pnpm test`)
- Branch state at end of session (`git log` / `git status`)
- File-by-file summaries of what was modified (`git diff --stat`)
- Commit summaries (already in `git log`)

If you find inventory in the existing CLAUDE.md, **delete it** as part of this closeout. Do not preserve it.

### D — Pending work / audit gaps / follow-ups → Linear (or surface to Dan)

Things that are **work items, not rules**. Examples:
- "Refund → Stripe wiring still pending"
- "Cleanup task: rename migration X to fix chronology"
- "TODO: regenerate types after type-cast removal"

**Rules:**
- Do NOT add work items to CLAUDE.md. They go stale and clutter the file.
- Surface them to Dan in the closeout summary so he can create Linear tickets.
- If a Linear MCP tool is available and Dan has indicated tickets should be auto-created, use it. Otherwise just list them.

### E — Code blocks that duplicate repo files → NOWHERE

If the rule is "use the pattern in `lib/x.ts`", do not paste the contents of `lib/x.ts` into CLAUDE.md. Reference the file by path instead. Claude can `Read` it when needed.

---

## Step 4 — Apply CLAUDE.md updates with hard guardrails

**Hard rules (do NOT violate):**

1. **Target ≤ 400 lines.** Run `wc -l CLAUDE.md` after your edits. If you're over 450, you must trim before committing — find sections to compress.
2. **Never create a new "Session Decisions — [date]" section.** §22–§28 anti-pattern. Promote rules into §1–§21 instead.
3. **Never add inventory tables.** See category C above.
4. **Never paste code blocks that duplicate actual repo files.** Reference files by path.
5. **Never add work items / audit gaps / pending steps.** They belong in Linear, not CLAUDE.md.
6. **Never duplicate an existing rule.** Update in place.
7. **One line per rule** wherever possible.

After making edits, run `wc -l CLAUDE.md`. If over 450, audit and trim. Acceptable range: 380–450 lines.

---

## Step 5 — Append session context to session log

Edit `~/.claude/memory/verco/session-log.md` and append a new dated section at the bottom in the format used by previous entries:

```markdown
## YYYY-MM-DD — [session topic]

[Verbose context here. Reasoning, architectural decisions, recovery procedures,
tech debt found, branch state, anything that would help a future session
understand "why did we do it this way".]

Commits this session: [hash list, optional]
```

The session log is your unbounded scratchpad — verbose is fine. Cross-reference with commit hashes.

---

## Step 6 — Update obsidian wiki if scope or architecture changed

Only relevant when the session involved a project with a brief or tech plan in `~/obsidian/Claude/wiki/projects/`. If today's work changed scope, reversed decisions, or invalidated assumptions in a brief/tech plan, update the relevant document. Example: this session updated `mud-module-tech-plan.md` when scope items were resolved with Dan in-session.

If the session was pure feature work with no scope changes, skip this step.

---

## Step 7 — Commit CLAUDE.md (if modified) and verify

If CLAUDE.md was modified:

```bash
wc -l CLAUDE.md   # MUST be ≤ 450
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
chore: update CLAUDE.md with session decisions — [topic]

[Brief 2-3 line summary of what rules were added/promoted/removed]

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

Note: the verco session log lives in `~/.claude/memory/verco/` which is Dan's local memory directory and is NOT in git. No commit step for that file.

---

## Step 8 — Final summary to Dan

End the closeout with a 4-line summary:

1. **Branch state**: `<branch>` is N commits ahead of origin/main (or "pushed", or "PR ready at <url>")
2. **Tests**: X/Y green
3. **CLAUDE.md**: N lines (target ≤ 400)
4. **Outstanding for Dan**: any category D items he needs to put in Linear, or any decisions that surfaced and need his eyes

Keep it brief. Dan is closing the laptop.

---

## Reference: lessons from the 8 April 2026 audit

The §22–§28 anti-pattern: from 27 March to 8 April, every closeout added a new "Session Decisions — [date]" section to CLAUDE.md with inventory tables (Edge Functions built, Migrations applied, Admin pages built, Test counts) and verbose decision context. This grew the file from 478 to 1172 lines in 12 days, repeatedly duplicating what was already in the filesystem and the session log.

The 8 April audit deleted ~770 lines (62% reduction), promoted ~50 lines of durable rules into §1–§21, and established the triage above. **This skill exists to prevent that pattern from recurring.** If you find yourself wanting to write "## Session Decisions — [date]" in CLAUDE.md, stop and re-read Step 3.
