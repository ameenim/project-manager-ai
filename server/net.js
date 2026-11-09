// Finding the address of the person who sent a request.
// The X-Forwarded-For header is written by every proxy on the way, and the browser can write it too. Only the entries
// added by our own hosting can be believed, and those are at the right hand end of the list. The left hand entries can
// be anything the sender typed, so reading the first one lets an attacker pick a new address on every try and walk past
// the rate limits. TRUST_PROXY_HOPS says how many proxies of ours sit in front of the app (default 1). Set it to 0 when
// the app is reached directly.
'use strict';

const hops = () => {
  const n = Number(process.env.TRUST_PROXY_HOPS);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 1;
};

const clean = (s) => String(s || '').trim().replace(/^::ffff:/i, '');
// loopback, private and link local addresses are our own network, never the person
const isInternal = (ip) => /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80:)/i.test(ip);

function clientIp(req) {
  const peer = clean(req.socket && req.socket.remoteAddress);
  const n = hops();
  if (!n) return peer;
  const list = [].concat(req.headers['x-forwarded-for'] || []).join(',').split(',').map(clean).filter(Boolean);
  if (!list.length) return peer;
  // entries from our own network count as proxy hops, then whatever hops are left are counted off from the right
  let used = 0;
  while (list.length > 1 && isInternal(list[list.length - 1])) { list.pop(); used++; }
  return list[Math.max(0, list.length - Math.max(1, n - used))];
}

module.exports = { clientIp, isInternal };
