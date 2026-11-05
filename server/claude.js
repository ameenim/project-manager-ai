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

// ---------- Claude with tools, streamed ----------
// Used by the Project Chat. It yields { type: 'text', text }, { type: 'tool_use', id, name, input } and finally
// { type: 'done', stop_reason, usage }. The key never leaves the server. There is no tool here that reaches the web
// or runs code: the caller decides which tools exist.
const CHAT_MODEL = process.env.CHAT_MODEL || MODEL;
async function* streamClaude({ system, messages, tools, max_tokens = 1500, signal, model }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('ANTHROPIC_API_KEY is not set on the server'), { status: 503, code: 'no_key' });
  const payload = { model: model || CHAT_MODEL, max_tokens, stream: true, system, messages };
  if (tools && tools.length) payload.tools = tools;
  // no temperature: newer models reject the setting
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  let idle = setTimeout(() => ctl.abort(), 60000);
  const total = setTimeout(() => ctl.abort(), 120000);
  try {
    const r = await fetch(API_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(payload), signal: ctl.signal });
    if (!r.ok) {
      const t = await r.text();
      throw Object.assign(new Error(`Claude API ${r.status}: ${t.slice(0, 300)}`), { status: r.status });
    }
    const blocks = new Map(); let stop = null; const usage = { input_tokens: 0, output_tokens: 0 };
    let buf = ''; const dec = new TextDecoder();
    for await (const chunk of r.body) {
      clearTimeout(idle); idle = setTimeout(() => ctl.abort(), 60000);
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
        if (ev.type === 'message_start' && ev.message && ev.message.usage) { usage.input_tokens = ev.message.usage.input_tokens || 0; usage.output_tokens = ev.message.usage.output_tokens || 0; }
        else if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'tool_use') blocks.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, json: '' });
        else if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'text_delta') yield { type: 'text', text: ev.delta.text };
          else if (ev.delta.type === 'input_json_delta' && blocks.has(ev.index)) blocks.get(ev.index).json += ev.delta.partial_json || '';
        } else if (ev.type === 'content_block_stop' && blocks.has(ev.index)) {
          const b = blocks.get(ev.index); blocks.delete(ev.index);
          let input = {}; try { input = b.json ? JSON.parse(b.json) : {}; } catch (e) { input = { __invalid: true }; }
          yield { type: 'tool_use', id: b.id, name: b.name, input };
        } else if (ev.type === 'message_delta') { if (ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason; if (ev.usage && ev.usage.output_tokens != null) usage.output_tokens = ev.usage.output_tokens; }
        else if (ev.type === 'error') throw Object.assign(new Error('Claude stream error: ' + ((ev.error && ev.error.message) || '')), { status: 502 });
      }
    }
    yield { type: 'done', stop_reason: stop, usage };
  } finally { clearTimeout(idle); clearTimeout(total); if (signal) signal.removeEventListener('abort', onAbort); }
}

module.exports = { callClaude, streamClaude, MODEL, CHAT_MODEL };
