# Security Policy

## Reporting a Vulnerability

Please do **not** open a public GitHub issue for security problems. Instead,
report them privately to the maintainers (for example via a GitHub Security
Advisory on this repository) and include:

- a description of the issue and its impact,
- steps to reproduce,
- any relevant logs or screenshots.

You can expect an acknowledgement within a few days. We will keep you updated on
the triage and fix, and credit you (if you wish) once the issue is resolved.

## Secrets and Configuration

This project loads configuration from untracked `.env` files.

- **Never commit real `.env` files.** They are ignored via `.gitignore`.
- Use the provided `backend/.env.example` and `frontend/.env.example` as templates.
- Do not paste real credentials into documentation, issues, or test fixtures.

If a secret is ever committed, treat it as compromised and **rotate it
immediately** (database credentials, API keys, tokens). Removing the file from a
later commit does not remove it from git history.

> **Note to maintainers:** a MongoDB connection string and an `EMERGENT_LLM_KEY`
> were previously committed in this repository. These must be rotated and the
> history purged before this repository is shared or made public.

## Scope

This application provides *assistive* guidance only. It is not a certified
safety or medical device and must not be relied upon as the sole means of
navigation or personal safety.
