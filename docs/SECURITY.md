# Security Baseline

## Non-negotiable boundaries

- Never connect to, inspect, mutate, migrate, export, or delete a real database without explicit approval.
- Never retrieve or request credentials, tokens, service-account files, or private keys.
- Never create a populated `.env`; `.env.example` contains placeholders only.
- Never call train-provider endpoints, Firebase/FCM, or cloud control planes by default.
- Never deploy, change IAM, enable APIs, create billable resources, or touch unrelated services without explicit approval.
- Never log authorization headers, identity tokens, FCM tokens, secrets, raw environment dumps, or sensitive provider payloads.

## Phase 0 controls

- Defensive `.gitignore` rules exclude common environment, credential, key, local database, cache, and build files.
- The application imports no database, Firebase, Google Cloud, HTTP-client, or notification adapter.
- Tests use an in-process FastAPI client and process-environment monkeypatching only.
- The liveness response contains only service, environment, and status labels.
- `scripts/check_secrets.py` fails on private-key headers, selected known token prefixes, and suspicious credential assignments. Placeholder values in `.env.example` are explicitly permitted.
- CI runs the secret check before installing the project.

The local scanner is defense in depth, not proof that a repository contains no secret. Human review and a dedicated secret-scanning platform should be added when the hosting platform and policy are approved.

## Future controls (not implemented)

Firebase token verification, authorization/ownership checks, service-to-service authentication, least-privilege identities, rate limiting, retention, encryption configuration, dependency scanning, container scanning, and cloud policy belong to later approval-gated phases.

## Reporting

If a suspected secret is discovered, do not print it. Report only its file and line number, stop processing that file as appropriate, and recommend rotation through the owning system. Never commit a real secret merely to test detection.
