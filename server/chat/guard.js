// The output check. Nothing reaches the browser, and nothing is saved, before it passes here. It blocks source code,
// scripts and queries, secrets, and text the model itself marked as out of scope. It also scrubs tool results, so
// secrets such as tokens and keys are never sent to the model in the first place.
'use strict';

const FENCE = /```|~~~/;
const MARKUP = /<script\b|<\?php|#!\/bin\/|<!doctype html|<html[\s>]|<iframe\b|<style[\s>]/i;
const SQL = /\b(?:select\s+[\w*,.\s`"]+\s+from\s+[\w."`]+|insert\s+into\s+[\w."`]+|update\s+[\w."`]+\s+set\s+[\w."`]+\s*=|delete\s+from\s+[\w."`]+|create\s+table\s+[\w."`]+|drop\s+table\s+[\w."`]+|alter\s+table\s+[\w."`]+)/i;
const FORMULA = /(?:^|\s)=\s*(?:SUM|SUMIF|SUMIFS|IF|IFS|VLOOKUP|XLOOKUP|INDEX|MATCH|COUNTIF|COUNTIFS|NETWORKDAYS|WORKDAY|AVERAGE|TEXT|DATEDIF|EDATE|ARRAYFORMULA|QUERY|FILTER)\s*\(/i;
const CODE_LINE = /^\s*(?:const|let|var|function|def|class|import|from\s+\S+\s+import|public|private|protected|static|return|elif|else:|for\s*\(|while\s*\(|if\s*\(|print\(|console\.|System\.out|#include|using\s+\w+;|package\s+\w+|async\s+function|await\s+\w+|try\s*\{|catch\s*\(|SELECT\s|INSERT\s|UPDATE\s+\w+\s+SET|\$\w+\s*=|@\w+\()/;
const BRACE_END = /(?:\{|\};?|\);|;)\s*$/;

function looksLikeCode(text) {
  const t = String(text || '');
  if (FENCE.test(t) || MARKUP.test(t) || SQL.test(t) || FORMULA.test(t)) return true;
  const lines = t.split('\n');
  let codey = 0, ends = 0;
  for (const l of lines) { if (CODE_LINE.test(l)) codey++; if (l.length < 120 && BRACE_END.test(l) && /[{}();=]/.test(l)) ends++; }
  return codey >= 2 || ends >= 4 || (codey >= 1 && ends >= 2);
}

const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i,
  /\b[a-f0-9]{64}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bxox[abp]-[A-Za-z0-9-]{10,}\b/,
];
function hasSecret(text, secrets) {
  const t = String(text || '');
  for (const p of SECRET_PATTERNS) if (p.test(t)) return true;
  for (const s of secrets || []) if (s && String(s).length >= 8 && t.includes(String(s))) return true;
  return false;
}

const MARKER = /\[\[\s*OUT_OF_SCOPE(?::\s*([a-z_]+))?\s*\]\]/i;

// Checks a whole reply. Returns { ok: true } or { ok: false, reason }.
function checkReply(text, secrets) {
  const t = String(text || '');
  const m = t.match(MARKER);
  if (m) return { ok: false, reason: (m[1] || 'content').toLowerCase() };
  if (looksLikeCode(t)) return { ok: false, reason: 'code' };
  if (hasSecret(t, secrets)) return { ok: false, reason: 'secret' };
  return { ok: true };
}

// Lets a reply stream to the browser while it is still being checked. Text is held back until whole lines have
// arrived, and everything seen so far is re-checked at each step, so code is blocked before it is shown.
class OutputGuard {
  constructor(secrets) { this.secrets = secrets || []; this.text = ''; this.sent = 0; this.blocked = null; }
  push(delta) {
    if (this.blocked) return '';
    this.text += delta;
    const c = checkReply(this.text, this.secrets);
    if (!c.ok) { this.blocked = c.reason; return ''; }
    // only whole lines go out, plus long prose lines up to their last space
    const nl = this.text.lastIndexOf('\n');
    let end = nl >= 0 ? nl + 1 : 0;
    if (end < this.sent) end = this.sent;
    const tail = this.text.slice(end);
    if (tail.length > 160 && !/[{}();=<>`$]/.test(tail)) { const sp = tail.lastIndexOf(' '); if (sp > 0) end += sp + 1; }
    const out = this.text.slice(this.sent, end);
    this.sent = end;
    return out;
  }
  // The rest of the text, once the reply is complete and has passed the full check.
  finish() {
    if (this.blocked) return { blocked: this.blocked, rest: '' };
    const c = checkReply(this.text, this.secrets);
    if (!c.ok) { this.blocked = c.reason; return { blocked: c.reason, rest: '' }; }
    const rest = this.text.slice(this.sent); this.sent = this.text.length;
    return { blocked: null, rest };
  }
}

// ---------- scrubbing what the model is allowed to see ----------
const SECRET_KEY = /token|secret|password|passwd|pw_|ingest|api[_-]?key|authorization|credential|conn_secrets|cookie|session/i;
function scrub(value, depth = 0) {
  if (depth > 8) return null;
  if (Array.isArray(value)) return value.slice(0, 200).map((x) => scrub(x, depth + 1));
  if (value && typeof value === 'object') {
    const o = {};
    for (const k of Object.keys(value)) {
      if (SECRET_KEY.test(k)) continue;
      if (k.startsWith('_') || k === 'client_logo' || k === 'avatar') continue;
      o[k] = scrub(value[k], depth + 1);
    }
    return o;
  }
  if (typeof value === 'string') return value.length > 1500 ? value.slice(0, 1500) + '…' : value;
  return value;
}

// Text that came from documents, Jira, Outlook or pasted messages. It is data, never instructions. When it tries to
// give instructions, the turn is marked so that nothing it seems to ask for can be proposed.
const INJECTION = /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|your|the)\b[^.\n]{0,30}\b(?:instructions|rules|prompt|guidelines|directions)\b|\b(?:you must|you should now|new instructions?|system prompt|assistant[:,]|as the assistant|<\s*system\s*>|\[\s*system\s*\])\b|\b(?:delete|remove|erase|wipe)\s+(?:all|every|the)\s+(?:risks?|tasks?|items?|records?|deliverables?|payments?|projects?)\b|(?:تجاهل|انس)[^.\n]{0,30}(?:التعليمات|القواعد)/i;
const looksInjected = (text) => INJECTION.test(String(text || ''));

module.exports = { looksLikeCode, hasSecret, checkReply, OutputGuard, scrub, looksInjected, MARKER };
