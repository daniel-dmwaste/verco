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

### Step 3 — Update CLAUDE.md
Add any new decisions, patterns, or conventions that aren't already documented. Look for:
- Any pattern used more than once that should become a convention
- Any fix that reveals a recurring mistake to avoid in future
- Any new Edge Functions and their auth patterns
- Any schema, naming, or RLS decisions made
- Any UI or layout conventions established
- Any bugs fixed that imply a rule to follow going forward

Do NOT add:
- Anything already in CLAUDE.md
- One-off fixes that aren't a general pattern
- UI copy changes

One line per decision where possible. Add to the most relevant existing section, or create a new section only if nothing fits.

### Step 4 — Commit CLAUDE.md
git add CLAUDE.md
git commit -m "chore: update CLAUDE.md with session decisions — [session topics]"
git push
