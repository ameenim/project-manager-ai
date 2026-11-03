# Project Manager AI

A bilingual (English and Arabic) project management app with schedules, Gantt charts, risk radar, portfolio dashboards and a brand kit. This version runs on demo data and needs no database.

## Run locally

Install Node 18 or newer, then run:

    npm start

Open http://localhost:5000

## Reading documents with AI

When a project is created or a document is uploaded, PDF, Word and Excel files are read by the server and the full text is analyzed by Claude. The browser never sees the API key.

1. Add a secret named `ANTHROPIC_API_KEY` in Replit (Tools, Secrets). Optionally add `ANTHROPIC_MODEL` to change the model.
2. Run `npm install` once (Replit does this on deploy). The server needs `pdf-parse`, `mammoth` and `xlsx`.
3. Create a project and attach the contract, proposal or purchase order. The Review tab shows progress for each file, then the deliverables, schedule, payment milestones, requirements and risks found.

Long documents are split into parts and every part is read. A fact is kept only when its source quote is found in the document text. If the key is missing, rejected or out of credit, or a file cannot be read (for example a scanned PDF), the Review tab says so for that file and a basic rule based reading is used instead.

Server routes (not part of the demo API): `POST /srv/extract` reads a file, `POST /srv/ai` forwards a request to Claude, `GET /srv/ai/status` reports whether the key is set.

## Run on Replit

Import this repository into Replit and press Run. The `.replit` file already points to `npm start`. To go live, use the Deploy button.

## Structure

The `public` folder holds the whole app: `index.html`, `styles.css`, the JavaScript modules and the `brand` logo files. `server.js` is a small static server with no dependencies.

## Notes

The demo data lives in `public/seed.js` and the in browser API in `public/mock.js`. Downloads are turned off in demo mode. To connect a real backend, replace the mock API calls in `mock.js` with real endpoints.


## How documents are analyzed

1. Ingestion and Parsing. The server reads PDF (scans through Claude vision), Word (tables kept), PowerPoint, Excel, pictures, Project XML and text. Old .doc, .ppt and .mpp files get an instruction to save in the newer format.
2. Retrieval. Each document gets a role: technical proposal, financial proposal, contract, award letter, purchase order or schedule file. The role decides what it may supply.
3. Contextual Analysis. Claude confirms the role and summarizes the document.
4. Analyzing. Every part of every page is read with a prompt for that role. Project info comes from all documents, deliverables and requirements from technical proposals and contracts, payment milestones from financial proposals, purchase orders and contracts, and the schedule from technical proposals and Project XML. Every item must carry a quote that is found in the text.
5. Response Generation. One schedule is built from the stated plan and then completed the way a project manager would: preparation, client review and approval steps for each deliverable and gate, with durations, owners and dependencies. Those added steps are marked "Added by AI" and carry a note on the assumption. Project risks (12 to 20, each naming the deliverable, date or party) are analyzed from the whole set together with the risks the documents list, and plain code checks run (value, payments, dates).
6. Filling project data. Items with confidence of 0.8 or more from AI reading are confirmed. The rest wait in the Review tab. The rule based fallback is never filled in automatically.


The prompts live in public/extract2.js (document roles, extraction, risks) and public/engine.js (schedule synthesis). They are written for a principal project manager persona and ask for references, prices, acceptance events, payment terms, durations and owners.
