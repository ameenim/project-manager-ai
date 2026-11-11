# Project Manager AI

A bilingual (English and Arabic) project management app with schedules, Gantt charts, risk radar, portfolio dashboards and a brand kit. It has a Node back end, a Postgres database, real accounts with roles, and import and export of projects.

## Run locally

Install Node 18 or newer, then run:

    npm install
    npm start

Open http://localhost:5000 and create an account. Without a `DATABASE_URL` the server uses an embedded Postgres that stores its files in the `data` folder, so local work needs no database setup.

## Settings (environment variables)

1. `DATABASE_URL` is the Postgres connection string. Replit provides it for the Development Database. Local/development startup applies the app's non-destructive migrations. In a published Replit app (`REPLIT_DEPLOYMENT=1`), Replit Publish owns schema changes: startup only verifies the required database objects and never replays schema migrations. A published app requires `DATABASE_URL`; it will not silently fall back to embedded storage.
2. `ANTHROPIC_API_KEY` turns on AI reading of documents. Optional `ANTHROPIC_MODEL` changes the model. Without a key a rule based reading is used.
3. `APP_TZ` sets the time zone used for "today" (default Asia/Dubai).
4. `SITE_URL` sets the public address used in the sitemap.
5. `DEMO_ACCOUNT=1` creates a demo account (pm@example.com with password demo1234) with sample projects. Leave it off in production.
6. `PORT` sets the port (default 5000).
7. `APP_SECRET` is a long random text used to encrypt saved connection tokens. If it is not set, a key is generated once and kept in the database.

## Connecting Jira and Outlook

People connect from Account settings, onboarding or project settings. The Connect button opens a step by step wizard: start, sign in and allow in a small window, then a live check and a Done screen. Tokens are encrypted and never sent to the browser.

The app owner does a one time setup so that the Connect button can sign people in:

1. Jira: create an OAuth 2.0 (3LO) app at https://developer.atlassian.com/console/myapps/ with the read scopes `read:me`, `read:jira-work`, `read:jira-user` and offline access. Add the callback `https://YOUR_SITE/oauth/callback/jira`. Set `ATLASSIAN_CLIENT_ID` and `ATLASSIAN_CLIENT_SECRET`.
2. Outlook: register an app in Microsoft Entra (App registrations) with the web redirect `https://YOUR_SITE/oauth/callback/outlook` and the delegated permissions `User.Read` and `Mail.Read`. Create a client secret. Set `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`. Optional `MICROSOFT_TENANT` limits sign in to one company.
3. Set `SITE_URL` to the public address so the redirect address is exact. The wizard shows the exact address to register while setup is missing. The Replit preview address and the published address are different, so register each one you use.

Jira also has a simpler fallback in the wizard: a personal API token, checked live against Jira.

## Accounts and roles

Sign up and sign in use the server. Passwords are hashed with scrypt, sessions are random tokens kept in an HttpOnly cookie, stored as hashes and expiring after 30 days, changes are protected by CSRF checks, and repeated failed sign ins are rate limited. Every project has members with one of three roles:

1. Project manager owns the project, manages access and is the only role that can delete it.
2. Editor changes content such as tasks, documents and reports.
3. Viewer can read everything and change nothing.

A person only ever sees projects they belong to. The manager adds people by email from the project Settings screen (the person must already have an account). The last manager of a project cannot be removed.

## Super admin console

Open `/admin` and sign in with an existing account. Only accounts flagged as super admin can enter. The first super admin is ameenim@gmail.com. Set `SUPER_ADMIN_EMAILS` (comma separated) to change the list. That account must already exist, because the list only promotes existing accounts. Set `SUPER_ADMIN_ALLOW_REGISTER=1` once if the account does not exist yet and you want to sign up with it.

The console covers:

- Users: create, edit, suspend, reset passwords, sign out everywhere, delete.
- Subscriptions: trial, plan, token limit, activate or extend.
- Finance: income ledger, monthly totals, CSV export. There is no payment processor, so income is a manual ledger and demo payments are excluded.
- AI: tokens and estimated cost by user, source and day. Cost uses the editable rates in Configuration.
- Projects and widgets: edit, transfer owner, delete.
- Configuration: trial days, plan price, token limit, AI rates, signup switch, limit enforcement, maintenance mode.
- Health: uptime from a per minute heartbeat, request and error counts.
- Errors: end user error log with resolve and clear.
- Audit: every admin change is recorded.

Super admins cannot suspend, demote or delete themselves, and the last active super admin is protected.

On a managed production database, run Publish in Replit after pulling. Migration 6 adds the tables the new version requires at startup.

## Widget marketplace

The Widgets screen lets each project manager add or remove widgets on the portfolio overview and on every project overview. Widgets are grouped (overview, schedule, financials, risk, delivery, team, trends, other), can be searched and filtered by group, source and rating, and can be previewed with the person's own project data before they are added. The Layouts button on an overview saves the shown widgets, their order and size under a name.

The widget builder creates a custom widget from a form. A widget is plain data (a spec with a dataset, filters and one of number, bars, columns, line, area, combo, donut, radar, funnel or table), never code, so a published widget can only read the projects of the person who runs it. The same file `public/widgetspec.js` validates a spec on the server and draws it in the browser. Publishing copies the draft to what everyone runs, so people who already added a widget change only when its author publishes again. Other project managers rate a widget from 1 to 5 stars with an optional comment after adding it. The marketplace keeps four tables (`widgets`, `widget_ratings`, `widget_installs`, `dash_layouts`, migration 5). On Replit the Publish step applies them to the production database.

## Editing a document and saving templates

Every generated document can be opened in a visual editor (Reports, then Edit, or Edit right after a document is created). The project manager can:

- change any text, with bold and italic, and use Enter to split a paragraph
- add sections, paragraphs, bulleted and numbered lists, and tables (add or remove rows and columns, Tab moves between cells)
- change the order of the headings by dragging a section or using the arrows (each section moves with its content and its charts)
- set the logo position on the cover and in the header, and the header and footer text, using tokens such as `{{project}}`, `{{client}}`, `{{title}}`, `{{date}}`, `{{pm}}`, `{{page}}` and `{{pages}}`
- undo and redo, download the current state, and save

The document is still stored as Markdown. The page layout is stored next to it as `layout` (`PUT /api/generated/:id` accepts `content`, `title` and `layout`). Word uses the full layout. PowerPoint and Excel use the header, footer and logo position as far as the format allows. The one slide status report is built from live project data, so it has no editor.

**Save as template** keeps the order, headings, text and page layout. For each section the project manager chooses between Refresh from project data (new figures every time) and Keep my text (reused exactly, stored with a `<!-- fixed -->` marker). A template can be limited to one document type or offered for all types (`doc_type` of `*`). Choosing a template in Create a document applies its sections and its layout.

## One slide status report

Reports, Create a document, One Slide Status Report makes a single PowerPoint slide with the whole weekly status of a project. It shows the key facts, the stages, an activity table, the top risks, the project brief, completion with last week and this week, the status, reasons for delay, achievements, next steps and the decisions needed. It is always one slide in the platform colors with the platform logo. The full lists are in the speaker notes.

Last week comes from the daily snapshots, taken 7 to 14 days before the report date. When there is no snapshot the slide says so and shows no estimate. The slide is drawn from `onepager` data built in `public/visuals.js` and by `buildOnePager` in `public/export_pptx.js`.

## Saved work

Every change is saved to Postgres before the server answers, so a refresh, a new device or a server restart never loses work. Nothing is removed automatically. A project is deleted only when its project manager deletes it. If the server restarts while a document is being analyzed, the project stays and the Review tab offers Reanalyze.

## Import and export

1. Project backup: Settings, Export this project downloads a `.pmai.json` file (optionally with the original documents).
2. Workspace backup: Account, Backup and restore exports every project you can edit.
3. Import: Projects, Import project (or Account) reads either kind of backup. Imported projects get new ids and are added next to existing ones, never replacing them. The importer validates the file, drops broken links and reports what it fixed.
4. Schedule: Settings, Export this project, or the Gantt screen, gives CSV and Excel. Reports from the Reports tab download as Word, Excel, PowerPoint and Markdown. Microsoft Project XML import and export is on the Gantt screen.

## Reading documents with AI

When a project is created or a document is uploaded, PDF, Word, PowerPoint and Excel files are read by the server and analyzed by Claude. The browser never sees the API key. Long documents are split into parts and every part is read. A fact is kept only when its source quote is found in the document text. If the key is missing, rejected or out of credit, or a file cannot be read, the Review tab says so for that file and a basic rule based reading is used instead. Progress is polled from `GET /api/analysis/events`.

## Thinking Area (the former Project Chat)

The Thinking Area is where the project manager thinks through a project with AI and turns the result into changes. It has two views of the same threads: the side panel opened by the round button on every screen, and a full page workspace (Open as a full page, Thinking in the side menu, or the Thinking tab of a project) with a thread list that can be searched, renamed and pinned. An empty thread shows starter cards. A Think deeper switch gives the model room to reason before it answers, and uses more tokens. It keeps the same safety model as before: changes are proposals, nothing is saved until Apply, and every applied change can be undone.

- Project manager skill: `server/chat/skill/index.js` is attached to every turn. It makes the AI think and write like an experienced project manager and keeps it inside project management work and this platform (no code, no unrelated chat). It is versioned (`SKILL_VERSION`, written to the chat log on every turn) and changes only through code review. Parts for schedule, risk, requirements, reporting and setup are added only when the question or the screen needs them.
- Attachments: the file button stores a file in the open project with `purpose=store` (no analysis, no suggestions). The tools `read_document` (a page at a time, text treated as data) and `create_custom_document` (plan, then Apply, undo removes it) work from it. Skill version 1.1.0 adds the document practice.
- Schedule plans: `get_schedule_detail` (read) and `propose_schedule_plan` (up to 12 task changes, one card, combined impact from the same preview route as the Schedule screen, stale check, one undo). More than 5 changed tasks needs a second confirmation. Skill version 1.2.0.
- Connection guide: `get_connection_status` (read, no secrets) returns the ordered Jira or Outlook steps with done flags, one step at a time. Connecting questions are no longer refused by the scope gate, disconnecting still is. The empty state shows a Connect tile until one service is connected. Skill version 1.3.0.
- Templates and widgets: `list_templates` (read) and a `template` option on `generate_report` (checked against the document type). `create_widget` validates the spec with the same `public/widgetspec.js` as the Widgets screen, saves a private draft, can add it to an overview, and Undo deletes it. Meetings: `list_meetings`, `get_meeting` and `send_meeting_items` (log, task or Inbox, with Undo). `update_project` changes name, client, dates and value with a stale check. `create_template` builds a template from an attached file with Undo. `list_layouts` and `save_layout` save a named Overview layout (built in widget ids plus installed custom widgets, replace by name, Undo restores). Skill version 1.6.0.
- Settings: `THINK_MODEL` (falls back to `CHAT_MODEL`, then `ANTHROPIC_MODEL`), optional `THINK_DEEP_MODEL` for Think deeper, `THINK_DEEP_BUDGET` (default 4000 reasoning tokens) and `THINK_MAX_OUTPUT` (default 4000 answer tokens). If a model refuses extended thinking, the answer is asked again without it.
- Migration 10 adds `title` and `pinned` to `chat_threads`. On Replit, run Publish after pulling so the production database gets them.
- The rest of this section still describes the chat engine, which the Thinking Area extends.

### How the chat engine works

A chat button at the bottom corner of every screen opens a side panel. In a project it is about that project. On the portfolio screens it is about all projects, and a change there must name its project. The chat answers from the person's own data and shows its sources, explains how the platform works, and drafts short project messages. It never writes code or unrelated content and never manages accounts, billing or access.

- Changes are proposals. The model has tools that only prepare an action card. Nothing is saved until the person presses Apply. The server rechecks the role and that each record is unchanged, applies every change or none, writes one history entry per change marked as coming from the chat, and offers Undo for 7 days. Deleting, or changing more than 5 records, asks for a second confirmation.
- Rules live on the server: `server/chat/gate.js` (scope check before any AI cost), `guard.js` (blocks code and secrets in replies, scrubs tool data, flags instructions hidden in documents), `prompt.js` (system prompt and refusal wording in English and Arabic), `tools.js` (read tools, proposal tools, apply and undo), `chat.js` (threads, limits, log, http).
- Viewers can ask questions and get no change tools. A change always runs as the signed in person through the same routes as the screens.
- Limits (environment variables, defaults in brackets): `CHAT_PER_MINUTE` (20), `CHAT_PER_DAY` (200), `CHAT_APPLY_PER_HOUR` (50), `CHAT_LOG_DAYS` (90). `CHAT_MODEL` changes the model used for the chat. Without `ANTHROPIC_API_KEY` the chat refuses out of scope requests and says the AI is not set up for the rest.
- Tables: `chat_threads`, `chat_messages`, `chat_log` (migration 3). A thread belongs to one person and one context and is removed with its project. The log keeps counts and outcomes only.
- Phase C tools: change the start, duration or progress of one task (the card shows which tasks move and the project end before and after, from the same engine as the Schedule screen, and asks for a second confirmation when more than 5 tasks move), apply or dismiss a suggestion in Updates, and add a pasted message to Updates. Undo restores every task the change moved.
- Live check: `node scripts/chat-smoke.js` runs real Claude questions against a throwaway database. Run it where `ANTHROPIC_API_KEY` is saved, for example the Replit shell.
- Phase D: an empty chat shows a Today brief (late tasks, late payments, waiting updates, off track projects or open high risks) as plain counts from the same routes as the screens, and each count opens the matching question. Suggestions follow the screen. `GET /api/chat/feedback` lists your own thumbs down answers with the question that led to each, for quality review. The Arabic scope check has its own test set.
- Reports: the chat can propose generating a standard document (charter, plans, weekly or biweekly status) in Word, Excel or PowerPoint. It is created from the project data without AI, appears in the Reports tab after Apply, and Undo removes it. A card that fails removes any document it made.
- Proactive suggestions: `server/chat/suggest.js` computes plain rules with no AI call (late tasks, schedule index below 0.95, forecast end after contract end, no baseline, deliverable due within 7 days with no task, late payments, waiting updates, weekly summary Monday to Wednesday). `GET /api/chat/suggestions` lists them and `POST /api/chat/suggestions/dismiss` hides one (dismiss until the condition changes, or snooze 7 days). The choice is stored per person in `chat_suggest_state` (migration 11). A count with a popover shows on the project Overview, the Schedule and the main dashboard.
- Schedule versions and baseline: the chat can list saved versions and compare one with the current schedule, save a version, set the baseline, and restore an earlier version (strong card, the current schedule is saved first, so Undo brings it back). No new migration.
- Task links: `set_task_links` replaces the predecessors of one task (types FS, SS, FF, SF with a lag). Loops are refused by the same preview route as the Schedule screen, the card shows the effect on the project end, and Undo restores the old links. Skill version 1.7.1.
- Pasted images: the composer takes up to 3 images by paste, drop or the image button. The browser shrinks them (long side 1568 px), the server checks the real bytes (PNG, JPEG, WebP, GIF, 3 MB each, 6 MB total) and sends them to the model for that turn only. Only a note that an image was pasted is saved in the chat. Skill 1.9.0 treats text inside an image as data and declines images that are not about project work.
- Not in this release: nothing planned from the original Thinking Area scope is left open.

## Tests

    npm test

The suite starts the real server on an in memory Postgres and covers accounts, roles, persistence across restart, analysis, import and export, spreadsheet and report formats, and request hardening.

## Run on Replit

Import this repository into Replit, add a Postgres database, add the secrets above and press Run. The `.replit` file points to `npm start`. To go live, use the Deploy button.

## Structure

1. `public` holds the front end: HTML, CSS and the JavaScript modules.
2. `server.js` starts the server. `server/app.js` is the HTTP layer, `server/api.js` holds the routes, `server/store.js` and `server/db.js` handle Postgres, `server/auth.js` handles accounts, and `server/exporter.js` and `server/importer.js` handle backups and files.
3. `test` holds the automated tests.
4. Trends. `server/snapshots.js` keeps one row per project per day in `project_snapshots` (saved hourly and whenever a trends page is read, last capture of the day wins). `GET /api/trends` and `GET /api/projects/:id/trends` return the daily series, and `public/app_trends.js` draws the Trends page and the project Trends tab. Days with no snapshot stay empty and nothing is back filled. History is included in backups.

## Generated documents

Reports are written by the server and kept with the project. Word, Excel and PowerPoint files are built in the browser with the platform logo, client, project, date and charts, using the libraries in `public/vendor/` (see its README). The format is chosen first and the download uses that same format. Create a document offers a standard document or a custom document. A custom document takes three steps: the name, the audience and a short description, then a suggestion of the closest template and the sections to include (picked by Claude when ANTHROPIC_API_KEY is set, by rules otherwise, at `/api/projects/:id/doc-plan`), then generation with the default system design template. Sections can be switched off, renamed, reordered or added before generating. The Reports tab has a folder view where documents can be dragged into folders and renamed. The server can also produce the same formats at `/api/generated/:id/docx`, `xlsx`, `pptx` and `md`.

## Known limits

1. The trial and billing screens and the onboarding tour keep their state in the browser.
2. Connections are verified and stored, but importing Jira issues or Outlook email into projects is not part of this version.

## How documents are analyzed

1. Ingestion and Parsing. The server reads PDF (scans through Claude vision), Word (tables kept), PowerPoint, Excel, pictures, Project XML and text. Old .doc, .ppt and .mpp files get an instruction to save in the newer format.
2. Retrieval. Each document gets a role: technical proposal, financial proposal, contract, award letter, purchase order or schedule file. The role decides what it may supply.
3. Contextual Analysis. Claude confirms the role and summarizes the document.
4. Analyzing. Every part of every page is read with a prompt for that role. Project info comes from all documents, deliverables and requirements from technical proposals and contracts, payment milestones from financial proposals, purchase orders and contracts, and the schedule from technical proposals and Project XML. Every item must carry a quote that is found in the text.
5. Response Generation. One schedule is built from the stated plan and then completed the way a project manager would: preparation, client review and approval steps for each deliverable and gate, with durations, owners and dependencies. Those added steps are marked "Added by AI" and carry a note on the assumption. Project risks (12 to 20, each naming the deliverable, date or party) are analyzed from the whole set together with the risks the documents list, and plain code checks run (value, payments, dates).
6. Filling project data. Items with confidence of 0.8 or more from AI reading are confirmed. The rest wait in the Review tab. The rule based fallback is never filled in automatically.


The prompts live in server/extract2.js (document roles, extraction, risks) and public/engine.js (schedule synthesis). They are written for a principal project manager persona and ask for references, prices, acceptance events, payment terms, durations and owners.

## Sync history and automatic sync

The Updates tab shows when the project was last synced, when the next automatic sync is due, and a Sync history view with the last 50 runs (time, manual or scheduled, what each source found, and any errors). Auto sync is set per project (off, hourly, every 4 hours, daily or weekdays at a chosen time). The schedule is stored on the project, and the server checks for due syncs every minute and runs them as the person who set the schedule, so it keeps working when nobody has the page open. Endpoints: `GET /api/projects/:id/sync-history` and `PUT /api/projects/:id/sync-schedule`.

## Templates

On the Reports page, the Custom templates card has an Upload template button. Upload a Word (.docx, .dotx), PowerPoint (.pptx, .potx) or Excel (.xlsx, .xltx) file, then choose what the system takes from it:

- **Design pattern.** The logo, fonts, colors, styles, intro page (logo position), header text and footer text. It applies to every document type, so the document type is not asked for.
- **Document structure.** The headings of the file become the sections of one document type (the sheet names for Excel). The document type is required.
- **Both.** The design pattern and the sections, for one document type. The document type is required.

The dialog does not continue until a choice is made, and not until a document type is chosen when the structure is used. The server enforces the same rules. With an Anthropic key, Claude chooses the color roles and cleans the heading list. Without one, built in rules do the same job.

Documents made from a design template use its colors, fonts, logo, header, footer and intro page in the preview, editor, Word, PowerPoint and Excel files. Documents made from a structure template use its sections and the platform design. Status colors for good, warning and danger stay the same so they keep their meaning. A design template is offered for every document type. A structure or both template is offered only for its own type.

Open a template from the card to see and change what it carries (colors, fonts, logo and header and footer for a design, sections for a structure). Documents that already exist keep the style they were made with. Fonts are named in the files but not embedded, so the reader needs them installed. Templates saved before modes existed keep working: a look with sections counts as both, a look alone counts as design.

Code: `server/brand.js` (extraction), `public/app_clienttpl.js` (upload and viewer), `public/export.js` (`applyBrand`), tests in `test/clienttpl.test.js`.

## Editor: text color, logo, tables and charts

In the document editor you can color selected text with the A button in the toolbar (headings keep the document style). The Logo panel on the right changes or removes the logo for that document, and the logo travels with the page layout when you save the document as a template. A bulleted or numbered list has a Convert to table button, and a table has Convert to bullets and Create chart. In the chart dialog, tick the columns and rows to chart, edit values if needed, and pick column, bar, line or pie. Charts are stored in the Markdown as a `:::chart {json}` line, and text color as `{#RRGGBB:text}`, so every export (Word, PowerPoint, Excel) reads them. Excel keeps chart pictures and data tables but not text color.

Tests: `test/editor2.test.js`.

## Support tickets and Fix it

Users report problems, suggest ideas or ask questions from the Support page. When something fails, the app offers to open a ticket and fills in the page, the last clicks and the error. The ticket goes to the super admin console under Tickets. An AI briefing explains the likely cause, the suspected files, the risk and the size. Pressing Fix it sends the ticket to Claude Code, which runs in GitHub Actions, not inside the app. The reporter sees the status in plain words: received, reviewed, being fixed, fixed on dev, ready to go live, live.

### How Fix it works

1. The app sends a repository_dispatch event with ids only. Ticket text never travels through GitHub.
2. The job in `.github/workflows/ticket-fix.yml` runs `scripts/ticket-fix/run.js`. It fetches the redacted ticket package from the app over a signed request.
3. Claude Code changes the code on a branch named `ticket/t-N-attempt`, with limited tools and no secrets. The job runs `npm test` itself.
4. `scripts/ticket-fix/policy.json` decides whether the fix may merge by itself. Protected files, too many files or too many changed lines force a human review.
5. A safe fix is merged into the `dev` branch and the ticket becomes fixed on dev. Anything else stays a pull request and the ticket shows needs attention.
6. The super admin marks tickets ready to publish and then published after the production deploy. Production deploys stay manual.

### Setup

In Replit Secrets: `GITHUB_DISPATCH_TOKEN` (a fine grained token with contents write on the repo), `TICKET_WEBHOOK_SECRET` (a long random string), optionally `FIX_REPO` (default ameenim/project-manager-ai), `FIX_TARGET_BRANCH` (default dev) and `SITE_URL` (the public address the job can reach).

In GitHub repository secrets: `ANTHROPIC_API_KEY` and the same `TICKET_WEBHOOK_SECRET`. Allow GitHub Actions to create pull requests in the repository settings.

Migration 8 adds the `tickets` and `ticket_events` tables. Replit Publish applies it. Limits (attempts per ticket, fixes per day, automatic error tickets, AI triage) are in Configuration.

## Logs table columns and saved views

The Logs tab shows Type, Item, Status, Owner, Due date and Invoice amount by default. The Columns button adds any other field of an item (description, review status, share of contract, probability, impact, mitigation, linked deliverable, AI confidence, source document and quote, created date). A saved view remembers the columns, filters, search and sort under a name (for example Risk log or Payments) and shows as a one click tab above the table. Views belong to the person and follow them across projects. They live in `users.prefs.log_views` (no migration) and are read and written with `GET` and `PUT /api/me/log-views`. CSV export follows the visible columns.

## Notification center
A bell in the side menu (with an unread count, and a count badge on the phone menu button) replaces the top plan ribbon. `server/notifications.js` keeps one row per person, project and kind in `notifications` (migration 13). It covers late tasks and late payments per project and the plan state (trial days, 80 and 100 percent of tokens, trial or subscription ended, renewal within 3 days), using the same formulas as health and the Thinking Area suggestions. `GET /api/notifications` refreshes and lists, `POST /api/notifications/read` and `/dismiss` take an id or `all`. A dismissed notification returns only when its condition changes. If the table is missing (before Publish applies it) the list reports `available: false` and the old ribbon is shown instead, so the plan status is never hidden.
