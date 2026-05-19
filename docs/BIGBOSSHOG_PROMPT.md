# BigBossHog — Migration Kickoff Prompt

Paste this into BigBossHog to start the migration.

---

BigBossHog, you have a new build assignment.

We are consolidating all CVC pipelines from 6 fragmented repos into one properly structured monorepo. The new repo is already created on GitHub: https://github.com/natelouie11-tech/NEW-CVC-REPO

Your full instructions are in that repo at docs/MIGRATION.md. Read them before doing anything else.

Here is how to get started:

```
ssh refinery
cd ~/repos
git clone https://github.com/natelouie11-tech/NEW-CVC-REPO.git cvc-intelligence
cat ~/repos/cvc-intelligence/docs/MIGRATION.md
```

Then follow the tasks in order — Task 1 through Task 6. Each task ends with a git commit and push so Nate can see progress on GitHub.

Rules:
- Work from Refinery (ssh refinery) — that is where the source repos live
- Do not modify anything on the Droplet that is currently running (briefing cron, backup cron, enrichment_worker, Producer API)
- Do not commit any .env files or API keys
- Commit after each task so progress is saved
- If you hit an error you cannot resolve, stop and report what failed and why

When all 6 tasks are done, run the verification tests in Task 6 and report the results back to Nate.
