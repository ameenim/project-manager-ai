# Threat Model

## Project Overview

Project Manager AI is a Node.js web application (no web framework; a raw `http`
server in `server/app.js`) backed by PostgreSQL (`server/db.js`, `server/store.js`).
It lets users create projects, schedules, resources, documents, and meetings;
analyze uploaded documents with Claude; run a Project Chat; and connect external
services (Jira, Outlook/Microsoft Graph). The frontend is static assets in
`public/`. It is deployed on Replit as a public autoscale deployment at
`https://project-manager-ai.replit.app`.

## Assets

- **User accounts & sessions** — scrypt password hashes (`server/auth.js`),
  session tokens (random 32 bytes, only SHA-256 stored). Compromise enables
  impersonation and access to all of a user's projects.
- **Project data** — schedules, tasks, resources, documents, meeting
  transcripts/minutes, audit logs. Scoped per-project via `project_members`.
- **Integration credentials & tokens** — app-wide OAuth client IDs/secrets for
  Jira and Outlook (`app_secrets.oauth_*`), and per-user OAuth access/refresh
  tokens. Sealed with a key from `APP_SECRET` or a generated `conn_key`.
- **Application secrets** — `ANTHROPIC_API_KEY`, `APP_SECRET`, `DATABASE_URL`,
  ticket webhook HMAC secret, mailer credentials.
- **Admin surface** — super-admin (`user_flags.is_super`) can manage users,
  issue password-reset links, change subscriptions, and toggle maintenance mode.

## Trust Boundaries

- **Browser ↔ API** — all client requests are untrusted. Auth via Bearer token
  (scripts) or session cookie (web). Cookie + unsafe method requires same-site
  origin (`sec.fromOwnSite`) and a CSRF token (`sec.csrfFor`).
- **User ↔ User / Project** — enforced by `store.forUser` (loads only the
  caller's member projects) and `P_(id, level)` / `need()` role checks
  (manager > editor > viewer) in `server/api.js`.
- **User ↔ Admin** — `is_super` checked in `admin.route` before admin handlers.
- **Server ↔ External services** — outbound OAuth/Graph/Jira calls in
  `server/connectors.js`; inbound ticket webhook (`/api/hooks/tickets/*`) is
  unauthenticated but HMAC-verified.
- **Public ↔ Authenticated** — only auth/register/forgot/reset/client-error and
  static assets are public; all `/api` else require a valid session.

## Scan Anchors

- Production entry points: `server/app.js` (`handleApi`, `serveStatic`,
  `onRequest`), `server/api.js` (`handle`/`dispatch`, ~132 routes via `on(...)`).
- Authorization gate: `P_()` + `need()` in `server/api.js` (~line 108-175);
  membership load in `server/store.js` `forUser` (~line 56).
- Admin gate: `server/admin.js` `route()` (checks live `is_super`).
- Highest-risk areas: `server/connectors.js` (OAuth/SSRF, shared config),
  file import/export (`importer.js`, `exporter.js`, `safezip.js`, `extract*.js`),
  `server/chat/*` (tools run as the user), `server/tickets.js` hook.
- Shared/global config written by authenticated users: `connectors.saveConfig`
  via `POST /api/connections/{jira|outlook}/setup` — missing admin gate (finding).
- Dev-only / ignore unless proven reachable: `scripts/` (perf/e2e/smoke harness,
  benchmark seeds), `test/`, `server/seed.js` sample data.

## Threat Categories

### Spoofing / Authentication
Sessions are random and hashed at rest; login is rate-limited three ways and
timing-equalized. Reset links are single-use, 30-minute, hash-stored. CSRF +
origin checks protect cookie-based unsafe requests. Guarantee: every `/api`
route except the public auth set MUST resolve a valid non-suspended session.

### Tampering / Elevation of Privilege
Project access MUST go through `P_()`/`need()` so object IDs cannot cross
membership or role boundaries. Member role changes require `manager`. Admin
actions require `is_super`. SQL MUST stay parameterized (verified across
`store.js`/`db.js`). **Known gap:** app-wide OAuth config can be overwritten by
any authenticated user (`/api/connections/*/setup`) — broken function-level
authorization on a shared resource.

### Information Disclosure
API responses MUST be scoped to the caller's projects. **Known gap:**
`GET /api/chat/feedback` returns the caller's own past chat excerpts without
re-checking current project membership, leaking project details to a removed
member. Logs include client IP (accepted operational tradeoff for security
events; low sensitivity).

### SSRF
Outbound requests in `connectors.js` target fixed provider hosts (Atlassian,
Microsoft Graph); Jira base URL for token identify should be watched but was not
confirmed exploitable to internal ranges. Guarantee: user-supplied URLs used for
server-side fetch MUST be host-allowlisted.
