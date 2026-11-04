# Project Manager AI

A bilingual (English and Arabic) project management app with schedules, Gantt charts, risk radar, portfolio dashboards and a brand kit. It has a Node back end, a Postgres database, real accounts with roles, and import and export of projects.

## Run locally

Install Node 18 or newer, then run:

    npm install
    npm start

Open http://localhost:5000 and create an account. Without a `DATABASE_URL` the server uses an embedded Postgres that stores its files in the `data` folder, so local work needs no database setup.

## Settings (environment variables)

1. `DATABASE_URL` is the Postgres connection string. On Replit, create a Postgres database and this value is provided for you. Tables are created automatically on start.
2. `ANTHROPIC_API_KEY` turns on AI reading of documents. Optional `ANTHROPIC_MODEL` changes the model. Without a key a rule based reading is used.
3. `APP_TZ` sets the time zone used for "today" (default Asia/Dubai).
4. `SITE_URL` sets the public address used in the sitemap.
5. `DEMO_ACCOUNT=1` creates a demo account (pm@example.com with password demo1234) with sample projects. Leave it off in production.
6. `PORT` sets the port (default 5000).

## Accounts and roles

Sign up and sign in use the server. Passwords are hashed with scrypt, sessions are random tokens stored as hashes and expire after 30 days, and repeated failed sign ins are rate limited. Every project has members with one of three roles:

1. Project manager owns the project, manages access and is the only role that can delete it.
2. Editor changes content such as tasks, documents and reports.
3. Viewer can read everything and change nothing.

A person only ever sees projects they belong to. The manager adds people by email from the project Settings screen (the person must already have an account). The last manager of a project cannot be removed.

## Saved work

Every change is saved to Postgres before the server answers, so a refresh, a new device or a server restart never loses work. Nothing is removed automatically. A project is deleted only when its project manager deletes it. If the server restarts while a document is being analyzed, the project stays and the Review tab offers Reanalyze.

## Import and export

1. Project backup: Settings, Export this project downloads a `.pmai.json` file (optionally with the original documents).
2. Workspace backup: Account, Backup and restore exports every project you can edit.
3. Import: Projects, Import project (or Account) reads either kind of backup. Imported projects get new ids and are added next to existing ones, never replacing them. The importer validates the file, drops broken links and reports what it fixed.
4. Schedule: Settings, Export this project, or the Gantt screen, gives CSV and Excel. Reports from the Reports tab download as Word, Excel, PowerPoint and Markdown. Microsoft Project XML import and export is on the Gantt screen.

## Reading documents with AI

When a project is created or a document is uploaded, PDF, Word, PowerPoint and Excel files are read by the server and analyzed by Claude. The browser never sees the API key. Long documents are split into parts and every part is read. A fact is kept only when its source quote is found in the document text. If the key is missing, rejected or out of credit, or a file cannot be read, the Review tab says so for that file and a basic rule based reading is used instead. Progress is polled from `GET /api/analysis/events`.

## Tests

    npm test

The suite starts the real server on an in memory Postgres and covers accounts, roles, persistence across restart, analysis, import and export, spreadsheet and report formats, and request hardening.

## Run on Replit

Import this repository into Replit, add a Postgres database, add the secrets above and press Run. The `.replit` file points to `npm start`. To go live, use the Deploy button.

## Structure

1. `public` holds the front end: HTML, CSS and the JavaScript modules.
2. `server.js` starts the server. `server/app.js` is the HTTP layer, `server/api.js` holds the routes, `server/store.js` and `server/db.js` handle Postgres, `server/auth.js` handles accounts, and `server/exporter.js` and `server/importer.js` handle backups and files.
3. `test` holds the automated tests.

## Generated documents

Reports are written by the server and kept with the project. Word, Excel and PowerPoint files are built in the browser with the platform logo, client, project, date and charts, using the libraries in `public/vendor/` (see its README). The format is chosen first and the download uses that same format. The Reports tab has a folder view where documents can be dragged into folders and renamed. The server can also produce the same formats at `/api/generated/:id/docx`, `xlsx`, `pptx` and `md`.

## Known limits

1. The trial and billing screens and the onboarding tour keep their state in the browser.
2. Webhook intake from Teams, Outlook and Jira is not part of this version.

## How documents are analyzed

1. Ingestion and Parsing. The server reads PDF (scans through Claude vision), Word (tables kept), PowerPoint, Excel, pictures, Project XML and text. Old .doc, .ppt and .mpp files get an instruction to save in the newer format.
2. Retrieval. Each document gets a role: technical proposal, financial proposal, contract, award letter, purchase order or schedule file. The role decides what it may supply.
3. Contextual Analysis. Claude confirms the role and summarizes the document.
4. Analyzing. Every part of every page is read with a prompt for that role. Project info comes from all documents, deliverables and requirements from technical proposals and contracts, payment milestones from financial proposals, purchase orders and contracts, and the schedule from technical proposals and Project XML. Every item must carry a quote that is found in the text.
5. Response Generation. One schedule is built from the stated plan and then completed the way a project manager would: preparation, client review and approval steps for each deliverable and gate, with durations, owners and dependencies. Those added steps are marked "Added by AI" and carry a note on the assumption. Project risks (12 to 20, each naming the deliverable, date or party) are analyzed from the whole set together with the risks the documents list, and plain code checks run (value, payments, dates).
6. Filling project data. Items with confidence of 0.8 or more from AI reading are confirmed. The rest wait in the Review tab. The rule based fallback is never filled in automatically.


The prompts live in server/extract2.js (document roles, extraction, risks) and public/engine.js (schedule synthesis). They are written for a principal project manager persona and ask for references, prices, acceptance events, payment terms, durations and owners.
