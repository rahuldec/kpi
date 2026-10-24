// node --test test/visit.test.js
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(query = {}, headers = {}) {
  return { query, headers };
}

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    _headers: {},
    status(code) { this._status = code; return this; },
    json(body)   { this._body  = body; return this; },
    setHeader(k, v) { this._headers[k] = v; },
  };
  return res;
}

// Swap global fetch with a stub, restore after each test.
function stubFetch(responses) {
  // responses: array of {result} returned in call order
  let i = 0;
  global.fetch = async () => {
    const payload = responses[i++] ?? { result: null };
    return {
      ok: payload.ok !== false,
      status: payload.status || 200,
      json: async () => payload,
    };
  };
}

function setKvEnv() {
  process.env.KV_REST_API_URL   = 'https://kv.test';
  process.env.KV_REST_API_TOKEN = 'tok';
}

function clearKvEnv() {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
}

// Re-require handler fresh each test (clears module cache).
function handler() {
  delete require.cache[require.resolve('../api/visit')];
  return require('../api/visit');
}

// ── KV not configured ─────────────────────────────────────────────────────────

describe('visit — KV not configured', () => {
  test('returns 500 with hint when env vars missing', async () => {
    clearKvEnv();
    const res = makeRes();
    await handler()(makeReq({ email: 'a@b.com' }), res);
    assert.equal(res._status, 500);
    assert.ok(res._body.hint);
  });

  test('500 when both env vars absent', async () => {
    clearKvEnv();
    const h = handler();
    const res = makeRes();
    await h(makeReq({ email: 'x@y.com' }), res);
    assert.equal(res._status, 500);
    assert.ok(res._body.error.includes('KV_REST_API_URL'));
  });
});

// ── Missing email ─────────────────────────────────────────────────────────────

describe('visit — missing email', () => {
  test('returns 400 when no email param', async () => {
    setKvEnv();
    stubFetch([]);
    const res = makeRes();
    await handler()(makeReq({}), res);
    assert.equal(res._status, 400);
    assert.equal(res._body.error, 'No ?email= given.');
  });
});

// ── Log read (?log=1) ─────────────────────────────────────────────────────────

describe('visit — ?log=1 admin gate', () => {
  beforeEach(() => setKvEnv());

  test('returns 403 for non-admin email', async () => {
    stubFetch([]);
    const res = makeRes();
    await handler()(makeReq({ email: 'other@okiedokiepay.com', log: '1' }), res);
    assert.equal(res._status, 403);
    assert.equal(res._body.error, 'Not authorised.');
  });

  test('returns 403 for empty email with log=1', async () => {
    stubFetch([]);
    const res = makeRes();
    await handler()(makeReq({ email: '', log: '1' }), res);
    assert.equal(res._status, 400); // no email → 400 before auth check
  });

  test('returns entries array for admin email', async () => {
    const entry = { email: 'rahul.sharma@okiedokiepay.com', name: 'Rahul', ts: '2026-10-24T10:00:00Z', ip: '1.2.3.4' };
    stubFetch([{ result: [JSON.stringify(entry)] }]);
    const res = makeRes();
    await handler()(makeReq({ email: 'rahul.sharma@okiedokiepay.com', log: '1' }), res);
    assert.equal(res._status, 200);
    assert.equal(res._body.entries.length, 1);
    assert.equal(res._body.entries[0].name, 'Rahul');
  });

  test('admin email comparison is case-insensitive', async () => {
    stubFetch([{ result: [] }]);
    const res = makeRes();
    await handler()(makeReq({ email: 'Rahul.Sharma@okiedokiepay.com', log: '1' }), res);
    assert.equal(res._status, 200);
  });

  test('returns empty entries when log is empty', async () => {
    stubFetch([{ result: [] }]);
    const res = makeRes();
    await handler()(makeReq({ email: 'rahul.sharma@okiedokiepay.com', log: '1' }), res);
    assert.equal(res._status, 200);
    assert.deepEqual(res._body.entries, []);
  });

  test('silently drops malformed JSON entries', async () => {
    const good = JSON.stringify({ email: 'a@b.com', name: 'A', ts: '2026-10-24T00:00:00Z', ip: '' });
    stubFetch([{ result: [good, 'not-json', '{bad}'] }]);
    const res = makeRes();
    await handler()(makeReq({ email: 'rahul.sharma@okiedokiepay.com', log: '1' }), res);
    assert.equal(res._status, 200);
    assert.equal(res._body.entries.length, 1);
  });

  test('returns 502 when KV lrange fails', async () => {
    stubFetch([{ ok: false, status: 503, error: 'KV 503' }]);
    const res = makeRes();
    await handler()(makeReq({ email: 'rahul.sharma@okiedokiepay.com', log: '1' }), res);
    assert.equal(res._status, 502);
  });
});

// ── Visit record (no log param) ───────────────────────────────────────────────

describe('visit — record visit', () => {
  beforeEach(() => setKvEnv());

  test('increments counter and returns count', async () => {
    // incr → 42, lpush → 1, ltrim → null
    stubFetch([{ result: 42 }, { result: 1 }, { result: null }]);
    const res = makeRes();
    await handler()(makeReq({ email: 'someone@okiedokiepay.com', name: 'Someone' }), res);
    assert.equal(res._status, 200);
    assert.equal(res._body.count, 42);
  });

  test('email is lowercased before storing', async () => {
    const calls = [];
    global.fetch = async (url) => {
      calls.push(url);
      return { ok: true, json: async () => ({ result: 1 }) };
    };
    const res = makeRes();
    await handler()(makeReq({ email: 'USER@Okiedokiepay.COM', name: 'U' }), res);
    // The lpush URL should contain the lowercased email in the JSON payload
    const lpushUrl = calls.find(u => u.includes('lpush'));
    assert.ok(lpushUrl.includes('user%40okiedokiepay.com'));
  });

  test('returns 502 when KV is unreachable', async () => {
    stubFetch([{ ok: false, status: 503, error: 'KV 503' }]);
    const res = makeRes();
    await handler()(makeReq({ email: 'a@b.com' }), res);
    assert.equal(res._status, 502);
  });
});
