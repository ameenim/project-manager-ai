# Security

This page lists what protects Project Manager AI and the settings that keep it protected in production.

## Settings to check before going live

| Setting | Why it matters |
|---|---|
| APP_SECRET | A long random value. It encrypts the saved Jira and Outlook tokens. Without it the key sits in the same database as the tokens. |
| TRUST_PROXY_HOPS | How many proxies of ours sit in front of the app. The default is 1. Rate limits and sign in lockouts use the address this picks. Set it to 0 when the app is reached directly. |
| SUPER_ADMIN_EMAILS | The only emails that can hold the super admin role. Those addresses cannot be claimed by signing up. |
| TICKET_WEBHOOK_SECRET | Signs the requests between the app and the ticket fix job. |
| DEMO_ACCOUNT | Leave it unset in production. The demo password is public. |
| CSP_MODE | on is the default. Use report-only to watch without blocking, or off to remove the policy. |
| SITE_URL | Must start with https:// in production. Links in emails and reset links are built from it. |
| DEMO_BILLING | Leave it unset in production. Plan changes stay closed until a real payment processor is connected. |
| AUTH_RATE | Optional. Sign in and register requests allowed per minute from one address. The default is 40. |
| DATABASE_URL | Use sslmode=require so the database connection is encrypted. |

The admin System health page shows an Environment check list that flags every setting above that is unsafe. The same checks print a warning when the server starts in production.

## What is in place

Passwords are hashed with scrypt and a per user salt. Session tokens are random, only their hash is stored, they last 30 days and a person keeps at most 20 devices signed in. Changing a password signs out every other device.

Sign in attempts are limited per address and email, per address, and per email. Guessing the current password through a session is limited too. New passwords must be 8 characters or more and not one of the most common passwords.

Every project request checks the person's role on that project on the server. Viewers cannot edit and non members cannot see the project exist. The super admin switch is read from the database on every admin request and every admin change is written to an audit log.

Every response carries a Content Security Policy that blocks inline scripts, scripts from other sites and connections to other sites. It also carries HSTS, nosniff, frame protection and a locked down permissions policy. No page contains an inline script.

Uploads are limited in size. Office files are checked for zip bombs before they are opened. Spreadsheets are read in a separate thread with a time limit. Pictures must match their stated type by their first bytes. Connection tokens are encrypted with AES 256 GCM and never sent to the browser.

Sessions live in an HttpOnly cookie that browser scripts cannot read. On HTTPS the cookie is named __Host-pm_sid and is Secure and SameSite Strict. Every change made with a cookie must also send a matching CSRF token and come from the same site. Requests that use a bearer token are not affected, because browsers never attach those on their own. Plain HTTP requests are redirected to HTTPS in production and the Host header is checked.

Password reset is done by an admin. The admin creates a one time link that expires in 30 minutes, works once and replaces any older link for that person. Only a hash of the link is stored. The link is removed from the address bar as soon as the page opens, and it is only spent after the new password passes the policy.

Suspicious activity is written to a security log that the super admin can read on the Security page. It records failed and locked sign ins, rejected tokens and CSRF checks, denied admin requests, rate limit hits, refused uploads, odd file requests and blocked plan changes. Ten failed sign ins from one address in ten minutes raise an alert. Entries are pruned after 90 days.

Uploads are limited by type and size. Each file must be on the allowed list, its first bytes must match its extension and text files must not contain binary data. Files that do not pass are refused and logged. Request bodies must be JSON objects.

Plan changes cannot be made from the browser in production. Prices and plan limits come from the server, never from the request, and no card data is handled by the app.

A secret scanner (npm run scan:secrets) checks the files and, with --history, the whole Git history. CI runs it on every push.

## Spreadsheet dependency

SheetJS (`xlsx`) is pinned to version 0.20.3 from its official CDN, following the [SheetJS installation guidance](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/). The npm registry release remains at 0.18.5 and must not be used: the prototype pollution flaw (GHSA-4r6h-8v6p-xvw6) was fixed in 0.19.3 and the regular expression denial of service flaw (GHSA-5pgg-2g8v-p4x9) was fixed in 0.20.2. The lockfile records the tarball integrity hash. Spreadsheet imports retain worker isolation, memory and size limits, and a timeout as additional safeguards.

The upstream advisories list affected versions as [below 0.19.3 for prototype pollution](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) and [below 0.20.2 for ReDoS](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9). Their “Patched versions: None” field refers to releases on the npm registry, not the patched CDN release used here. Findings that flag this official 0.20.3 tarball for either advisory are false positives; check the resolved source and installed version rather than replacing it with npm's older release. Regression tests enforce the safe version, official tarball source, manifest/lockfile agreement and SHA-512 integrity metadata.

## Known items

Styles still allow inline style attributes, so the Content Security Policy keeps style-src 'unsafe-inline'. Scripts never do.

Admin accounts do not have multi factor sign in yet. A real payment processor with server side verification is needed before taking payments.

## Reporting a problem

Email the project owner with the steps to reproduce. Please do not open a public issue for a security problem.
