---
name: session-closeout
description: Use this skill to close out any Verco development session. Triggers when Dan says "that will do", "close out the session", "wrap up", "end the session", "we're done", "call it a day", "update claude.md", or any end-of-session phrase. Also trigger when Dan asks for a closing prompt, session review, or CLAUDE.md update at the end of a working session. Always use this skill — never generate a closeout prompt without it.
---

# Verco Session Close-Out

Generates a single ready-to-paste Claude Code prompt that cleanly closes out a Verco dev session.

## What CC will do with the prompt

1. Commit any uncommitted changes from the session
2. Review the git log to understand what was built
3. Update CLAUDE.md with new decisions, patterns, or conventions
4. Commit CLAUDE.md

## How to generate the prompt

Read the current conversation. Identify the main topics worked on. Use them only to fill in [BRIEF SUMMARY] in the commit message — 3–5 words, comma separated (e.g. service tickets, nav, collection dates).

Output the prompt below with [BRIEF SUMMARY] filled in. Nothing else — no preamble, no explanation. Dan pastes it straight into Claude Code.

---

## Prompt template

First, commit any uncommitted work from this session:
git add -A
git commit -m "feat: [BRIEF SUMMARY]"
git push

Then review the git log for this session and scan modified files to understand what was built or changed.

Update CLAUDE.md with any new decisions, patterns, or conventions that aren't already documented. Look for:

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

Then commit:
git add CLAUDE.md
git commit -m "chore: update CLAUDE.md with session decisions — [BRIEF SUMMARY]"
git push
