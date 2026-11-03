# Project Manager AI

A bilingual (English and Arabic) project management app with schedules, Gantt charts, risk radar, portfolio dashboards and a brand kit. This version runs on demo data and needs no database.

## Run locally

Install Node 18 or newer, then run:

    npm start

Open http://localhost:5000

## Run on Replit

Import this repository into Replit and press Run. The `.replit` file already points to `npm start`. To go live, use the Deploy button.

## Structure

The `public` folder holds the whole app: `index.html`, `styles.css`, the JavaScript modules and the `brand` logo files. `server.js` is a small static server with no dependencies.

## Notes

The demo data lives in `public/seed.js` and the in browser API in `public/mock.js`. Downloads are turned off in demo mode. To connect a real backend, replace the mock API calls in `mock.js` with real endpoints.
