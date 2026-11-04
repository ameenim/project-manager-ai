// Project Manager AI. Serves the app from ./public and the API from ./server, with data in Postgres.
// Set DATABASE_URL to use Postgres (Replit Postgres). Without it an embedded Postgres in ./data is used for local work.
// Optional: ANTHROPIC_API_KEY for AI reading of documents, PORT, APP_TZ, SITE_URL, DEMO_ACCOUNT=1.
'use strict';
const { createApp } = require('./server/app');
const { extractText } = require('./server/extract');

const PORT = process.env.PORT || 5000;

async function main() {
  const app = await createApp();
  await new Promise((ok) => app.server.listen(PORT, '0.0.0.0', ok));
  console.log(`Project Manager AI running on port ${PORT} (${app.db.kind === 'pg' ? 'Postgres' : 'embedded Postgres in ./data'})`);

  let closing = false;
  const stop = async (sig) => {
    if (closing) return; closing = true;
    console.log(`${sig} received, saving and shutting down`);
    const t = setTimeout(() => process.exit(1), 15000); t.unref();
    try { await app.close(); } catch (e) { console.error('shutdown error', e); }
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('unhandledRejection', (e) => console.error('unhandled rejection', e));
}

if (require.main === module) main().catch((e) => { console.error('Could not start the server:', e.message); process.exit(1); });

module.exports = { extractText };
