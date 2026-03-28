Review the git log for this session and scan any modified files to understand what was built or changed today.

Update CLAUDE.md to capture any new decisions, patterns, or conventions that aren't already documented. Look for:

- Any pattern used more than once that should become a convention
- Any fix that reveals a recurring mistake to avoid in future
- Any schema or naming decisions that were made or changed
- Any new Edge Functions deployed and their auth patterns
- Any UI or layout conventions established
- Any bugs fixed that imply a rule to follow going forward

Do NOT add:
- Anything already documented in CLAUDE.md
- One-off fixes that aren't a general pattern
- UI copy changes

Keep additions concise — one line per decision where possible. Add to the most relevant existing section, or create a new section only if nothing fits.

Then commit:
git add CLAUDE.md
git commit -m "chore: update CLAUDE.md with session decisions — dashboard, FAB, edge function fixes, OTP"
git push
