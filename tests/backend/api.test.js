'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

const { app, server, store } = require('../../server');

let baseUrl;

test.before(async () => {
  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
});

async function req(path, opts = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let body;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) body = await res.json();
  else body = await res.text();
  return { status: res.status, body };
}

// ── Health ──────────────────────────────────────────────────────────────────
test('GET /api/health returns ok', async () => {
  const { status, body } = await req('/api/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.ok(typeof body.ts === 'string');
});

// ── 404 ─────────────────────────────────────────────────────────────────────
test('Unknown routes return 404 JSON', async () => {
  const { status, body } = await req('/api/does-not-exist');
  assert.equal(status, 404);
  assert.equal(body.error, 'Not found');
});

// ── Channels ────────────────────────────────────────────────────────────────
test('GET /api/channels returns the seeded list', async () => {
  const { status, body } = await req('/api/channels');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
  assert.ok(body.find(c => c.id === 'general'));
});

test('POST /api/channels rejects empty name (input validation)', async () => {
  const { status, body } = await req('/api/channels', { method: 'POST', body: { name: '' } });
  assert.equal(status, 400);
  assert.match(body.error, /Channel name/);
});

test('POST /api/channels rejects non-string name (input validation)', async () => {
  const { status } = await req('/api/channels', { method: 'POST', body: { name: 12345 } });
  assert.equal(status, 400);
});

test('POST /api/channels rejects name longer than 80 chars', async () => {
  const { status } = await req('/api/channels', {
    method: 'POST',
    body: { name: 'x'.repeat(81) },
  });
  assert.equal(status, 400);
});

test('POST /api/channels creates a channel and slugifies the name', async () => {
  const { status, body } = await req('/api/channels', {
    method: 'POST',
    body: { name: '  Marketing Wins  ', description: 'Wins by the marketing team' },
  });
  assert.equal(status, 201);
  assert.equal(body.name, 'marketing-wins');
  assert.equal(body.id, 'marketing-wins');
});

test('POST /api/channels rejects duplicate names with 409', async () => {
  const { status } = await req('/api/channels', {
    method: 'POST',
    body: { name: 'general' },
  });
  assert.equal(status, 409);
});

test('POST /api/channels rejects too-long description', async () => {
  const { status } = await req('/api/channels', {
    method: 'POST',
    body: { name: 'desc-test', description: 'x'.repeat(251) },
  });
  assert.equal(status, 400);
});

// ── Messages ────────────────────────────────────────────────────────────────
test('GET /api/channels/:id/messages returns 404 for unknown channel', async () => {
  const { status, body } = await req('/api/channels/__nope__/messages');
  assert.equal(status, 404);
  assert.equal(body.error, 'Channel not found');
});

test('POST messages rejects empty text (input validation)', async () => {
  const { status, body } = await req('/api/channels/general/messages', {
    method: 'POST',
    body: { text: '   ', user: 'Tester' },
  });
  assert.equal(status, 400);
  assert.match(body.error, /Message text/);
});

test('POST messages rejects text longer than 4000 chars', async () => {
  const { status } = await req('/api/channels/general/messages', {
    method: 'POST',
    body: { text: 'x'.repeat(4001), user: 'Tester' },
  });
  assert.equal(status, 400);
});

test('POST messages sanitizes HTML / script payloads (XSS guard)', async () => {
  const { status, body } = await req('/api/channels/general/messages', {
    method: 'POST',
    body: { text: '<script>alert(1)</script>', user: 'Tester' },
  });
  assert.equal(status, 201);
  assert.ok(!body.text.includes('<script>'));
  assert.ok(body.text.includes('&lt;script&gt;'));
});

test('POST messages defaults user to Anonymous when missing', async () => {
  const { status, body } = await req('/api/channels/general/messages', {
    method: 'POST',
    body: { text: 'hello world' },
  });
  assert.equal(status, 201);
  assert.equal(body.user, 'Anonymous');
});

// ── Tasks ───────────────────────────────────────────────────────────────────
test('POST /api/tasks rejects empty text', async () => {
  const { status } = await req('/api/tasks', { method: 'POST', body: { text: '' } });
  assert.equal(status, 400);
});

test('POST /api/tasks rejects text longer than 500 chars', async () => {
  const { status } = await req('/api/tasks', {
    method: 'POST',
    body: { text: 'x'.repeat(501) },
  });
  assert.equal(status, 400);
});

test('POST /api/tasks coerces invalid priority to medium', async () => {
  const { status, body } = await req('/api/tasks', {
    method: 'POST',
    body: { text: 'Test task', priority: 'urgent' },
  });
  assert.equal(status, 201);
  assert.equal(body.priority, 'medium');
});

test('POST /api/tasks accepts a valid priority', async () => {
  const { status, body } = await req('/api/tasks', {
    method: 'POST',
    body: { text: 'High prio task', priority: 'high' },
  });
  assert.equal(status, 201);
  assert.equal(body.priority, 'high');
});

test('PATCH /api/tasks/:id updates known fields and ignores invalid status', async () => {
  const created = await req('/api/tasks', {
    method: 'POST',
    body: { text: 'Patchable task' },
  });
  const id = created.body.id;

  const ok = await req(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: { status: 'in-progress', priority: 'low' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'in-progress');
  assert.equal(ok.body.priority, 'low');

  const bogus = await req(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: { status: 'banana', priority: 'galactic' },
  });
  assert.equal(bogus.status, 200);
  assert.equal(bogus.body.status, 'in-progress');
  assert.equal(bogus.body.priority, 'low');
});

test('PATCH /api/tasks/:id 404 for unknown id', async () => {
  const { status } = await req('/api/tasks/__nope__', {
    method: 'PATCH',
    body: { status: 'completed' },
  });
  assert.equal(status, 404);
});

test('DELETE /api/tasks/:id removes a task and 404s thereafter', async () => {
  const created = await req('/api/tasks', { method: 'POST', body: { text: 'Disposable' } });
  const id = created.body.id;

  const del = await req(`/api/tasks/${id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal(del.body.deleted, true);

  const again = await req(`/api/tasks/${id}`, { method: 'DELETE' });
  assert.equal(again.status, 404);
});

// ── Docs ────────────────────────────────────────────────────────────────────
test('GET /api/docs/preview rejects URL without a doc id', async () => {
  const { status, body } = await req('/api/docs/preview?url=https://example.com/foo');
  assert.equal(status, 400);
  assert.match(body.error, /Invalid Google Docs URL/);
});

test('GET /api/docs/preview returns cached preview for seeded doc id', async () => {
  const url =
    'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit';
  const { status, body } = await req(`/api/docs/preview?url=${encodeURIComponent(url)}`);
  assert.equal(status, 200);
  assert.equal(body.docId, '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms');
  assert.ok(body.title);
});

test('GET /api/docs/summary requires docId', async () => {
  const { status, body } = await req('/api/docs/summary');
  assert.equal(status, 400);
  assert.match(body.error, /docId required/);
});

// ── Workflows ───────────────────────────────────────────────────────────────
test('POST /api/workflows rejects missing name', async () => {
  const { status, body } = await req('/api/workflows', { method: 'POST', body: {} });
  assert.equal(status, 400);
  assert.match(body.error, /Workflow name/);
});

test('PATCH /api/workflows/:id 404 for unknown id', async () => {
  const { status } = await req('/api/workflows/__nope__', {
    method: 'PATCH',
    body: { enabled: false },
  });
  assert.equal(status, 404);
});

test('POST /api/scheduler/fire rejects request without secret header', async () => {
  app.set('schedulerSecret', 'unit-test-secret');
  const { status, body } = await req('/api/scheduler/fire', { method: 'POST', body: {} });
  assert.equal(status, 401);
  assert.equal(body.error, 'Unauthorized');
});

test('POST /api/scheduler/fire accepts a matching secret header', async () => {
  app.set('schedulerSecret', 'unit-test-secret');
  const { status, body } = await req('/api/scheduler/fire', {
    method: 'POST',
    body: {},
    headers: { 'x-colliq-scheduler': 'unit-test-secret' },
  });
  assert.equal(status, 200);
  assert.ok(typeof body.fired === 'number');
});

// ── Search ──────────────────────────────────────────────────────────────────
test('GET /api/search returns empty buckets for blank query', async () => {
  const { status, body } = await req('/api/search?q=');
  assert.equal(status, 200);
  assert.deepEqual(body.messages, []);
  assert.deepEqual(body.tasks, []);
  assert.deepEqual(body.docs, []);
});

test('GET /api/search finds messages by substring (case-insensitive)', async () => {
  await req('/api/channels/general/messages', {
    method: 'POST',
    body: { text: 'Searchable-NEEDLE-token', user: 'Tester' },
  });
  const { status, body } = await req('/api/search?q=needle');
  assert.equal(status, 200);
  assert.ok(body.messages.some(m => m.text.toLowerCase().includes('needle')));
});

// ── In-memory store sanity ──────────────────────────────────────────────────
test('store: every channel has a message bucket initialized', () => {
  for (const c of store.channels) {
    assert.ok(Array.isArray(store.messages[c.id]), `missing bucket for ${c.id}`);
  }
});
