# Free the Brain — notes for Claude sessions

## Two homes
- Code: this repo. Merging to main deploys service/ and mcp/ via .github/workflows/deploy.yml. site/ and client/ are uploaded via the Cloudflare dashboard.
- Task Registry data: Google Drive folder "Task Registry" (ID 1yZabLPGJAkxeu748rA89swQLDoFuMRu8), via the Google Drive connector. Canonical until FtB flips it to archive.

## Registry rules (non-negotiable)
- Read `_REGISTRY PROTOCOL — Delta Writes v1.md` in that folder before any write.
- Read registry files with download_file_content (raw bytes), never read_file_content.
- Never overwrite, update or delete a registry file. Every write is a NEW "Registry Delta — YYYY-MM-DD-HHMM.md", stamped Europe/Sofia 24h from the system clock. Full snapshots (compaction) only on FtB's explicit word.
- Covenant: never change U, I, Status, Category, Deadline or Triaged, and never drop a row, without FtB's explicit instruction. Captures (Status=Inbox, unscored) are allowed.
- Always write a task ID with its name, e.g. "T-087 (PTO as MCP server + app)".
- GT Inbox / GT Outbox files belong to the Google Tasks relay; never edit them.

## Secrets
Never put tokens or secrets in the repo, Drive, or PR text. They live in GitHub Actions secrets and Cloudflare.
