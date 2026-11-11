---
description: Write a handoff note into the active task so another agent can resume
---

Update the active task file's Handoff section with:

- **Done:** what is finished, with evidence links.
- **Not done:** what remains, as concrete next steps with file paths.
- **How to resume:** the branch, the worktree path, and the commands to run first.
- **Open questions:** anything that needs Rafa or another lane.
- **Risks noticed:** anything outside this task's scope that looks wrong.

Append a three-line entry (done, next, blocked) to the day's log entry. The maintainers keep the daily log in the private repository, as `control/log/<today>.md` (checked out at `reports/crow-private/` inside the main checkout on the maintainer's machine). Without that checkout, skip this step: the Handoff section carries the note.
