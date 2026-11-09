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

## What is in place

Passwords are hashed with scrypt and a per user salt. Session tokens are random, only their hash is stored, they last 30 days and a person keeps at most 20 devices signed in. Changing a password signs out every other device.

Sign in attempts are limited per address and email, per address, and per email. Guessing the current password through a session is limited too. New passwords must be 8 characters or more and not one of the most common passwords.

Every project request checks the person's role on that project on the server. Viewers cannot edit and non members cannot see the project exist. The super admin switch is read from the database on every admin request and every admin change is written to an audit log.

Every response carries a Content Security Policy that blocks inline scripts, scripts from other sites and connections to other sites. It also carries HSTS, nosniff, frame protection and a locked down permissions policy. No page contains an inline script.

Uploads are limited in size. Office files are checked for zip bombs before they are opened. Spreadsheets are read in a separate thread with a time limit. Pictures must match their stated type by their first bytes. Connection tokens are encrypted with AES 256 GCM and never sent to the browser.

## Known items

The xlsx package has two published flaws and no fixed release on npm. The app reads spreadsheets in an isolated thread to contain them. When SheetJS publishes a fixed build you can install it from https://cdn.sheetjs.com and remove this note.

The session token is kept in browser local storage. The Content Security Policy is the main protection against it being read. Moving it to an HttpOnly cookie would need a CSRF defense and is a larger change.

## Reporting a problem

Email the project owner with the steps to reproduce. Please do not open a public issue for a security problem.
