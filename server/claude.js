// Calls the Claude API. The key never leaves the server.
'use strict';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const API_URL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '') + '/v1/messages';

// ---------- Claude proxy ----------
async function callClaude(payload) {
  const key = process.env.ANTHROPIC_API_KEY;
  // The reply is streamed so a long answer (a full schedule) is not lost to one long request timeout.
  // The call only fails when no data arrives for two minutes or the whole answer takes over ten minutes.
  const body = JSON.stringify({ model: MODEL, max_tokens: payload.max_tokens, stream: true, system: payload.system, messages: [{ role: 'user', content: payload.content || payload.user }] });
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    let idle = setTimeout(() => ctl.abort(), 120000);
    const total = setTimeout(() => ctl.abort(), 600000);
    try {
      const r = await fetch(API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body,
        signal: ctl.signal,
      });
      if (r.ok) {
        let text = ''; let stop = null; let usage = null; let buf = '';
        const dec = new TextDecoder();
        for await (const chunk of r.body) {
          clearTimeout(idle); idle = setTimeout(() => ctl.abort(), 120000);
          buf += dec.decode(chunk, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
            if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') text += ev.delta.text;
            else if (ev.type === 'message_delta') { if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason; if (ev.usage) usage = ev.usage; }
            else if (ev.type === 'error') throw Object.assign(new Error('Claude stream error: ' + ((ev.error && ev.error.message) || '')), { status: 502 });
          }
        }
        console.log('claude ok', JSON.stringify({ stop, chars: text.length, out: usage && usage.output_tokens, head: text.slice(0, 120) }));
        return { text, stop_reason: stop, usage };
      }
      const t = await r.text();
      last = { status: r.status, message: t.slice(0, 300) };
      if (r.status !== 429 && r.status < 500) break;
    } finally { clearTimeout(idle); clearTimeout(total); }
    await new Promise((ok) => setTimeout(ok, 1500));
  }
  throw Object.assign(new Error(`Claude API ${last.status}: ${last.message}`), { status: last.status });
}

module.exports = { callClaude, MODEL };
