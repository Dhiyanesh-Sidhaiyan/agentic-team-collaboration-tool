'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_TEXT_LEN,
  PRIORITIES,
  TASK_STATUSES,
  sanitize,
  validateString,
  avatarOf,
  extractDocId,
  extractSheetsId,
  detectGoogleUrl,
  interpolate,
  isValidPriority,
  isValidTaskStatus,
  mkId,
  now,
} = require('../../lib/validators');

// ── sanitize ────────────────────────────────────────────────────────────────
test('sanitize: escapes <script> tags', () => {
  assert.equal(
    sanitize('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;'
  );
});

test('sanitize: escapes ampersand, quotes, and apostrophes', () => {
  assert.equal(sanitize(`a & b "c" 'd'`), 'a &amp; b &quot;c&quot; &#x27;d&#x27;');
});

test('sanitize: trims surrounding whitespace', () => {
  assert.equal(sanitize('   hello   '), 'hello');
});

test('sanitize: returns empty string for non-strings', () => {
  for (const v of [null, undefined, 123, {}, [], true, NaN]) {
    assert.equal(sanitize(v), '');
  }
});

test(`sanitize: caps output at ${MAX_TEXT_LEN} chars`, () => {
  const huge = 'x'.repeat(MAX_TEXT_LEN + 500);
  assert.equal(sanitize(huge).length, MAX_TEXT_LEN);
});

test('sanitize: empty string stays empty', () => {
  assert.equal(sanitize(''), '');
});

// ── validateString ──────────────────────────────────────────────────────────
test('validateString: rejects non-strings', () => {
  for (const v of [null, undefined, 0, 1, {}, [], true]) {
    assert.equal(validateString(v), false);
  }
});

test('validateString: rejects empty / whitespace-only strings by default', () => {
  assert.equal(validateString(''), false);
  assert.equal(validateString('   '), false);
  assert.equal(validateString('\t\n'), false);
});

test('validateString: accepts strings within bounds', () => {
  assert.equal(validateString('hello'), true);
  assert.equal(validateString('a', 1, 1), true);
});

test('validateString: enforces min length', () => {
  assert.equal(validateString('ab', 3, 10), false);
  assert.equal(validateString('abc', 3, 10), true);
});

test('validateString: enforces max length', () => {
  assert.equal(validateString('a'.repeat(11), 1, 10), false);
  assert.equal(validateString('a'.repeat(10), 1, 10), true);
});

test('validateString: trims before measuring length', () => {
  assert.equal(validateString('   hi   ', 1, 5), true);
  assert.equal(validateString('   hi   ', 5, 10), false);
});

// ── avatarOf ────────────────────────────────────────────────────────────────
test('avatarOf: builds initials from a name', () => {
  assert.equal(avatarOf('Alice Chen'), 'AC');
  assert.equal(avatarOf('alice chen'), 'AC');
});

test('avatarOf: caps initials at 2 chars', () => {
  assert.equal(avatarOf('Mary Jane Watson Parker'), 'MJ');
});

test('avatarOf: handles single word', () => {
  assert.equal(avatarOf('Cher'), 'C');
});

test('avatarOf: handles non-string input gracefully', () => {
  assert.equal(avatarOf(undefined), '');
  assert.equal(avatarOf(null), '');
  assert.equal(avatarOf(42), '4');
});

test('avatarOf: collapses extra spaces', () => {
  assert.equal(avatarOf('  Bob   Smith  '), 'BS');
});

// ── extractDocId ────────────────────────────────────────────────────────────
test('extractDocId: pulls id from a Google Docs URL', () => {
  const url = 'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit';
  assert.equal(extractDocId(url), '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms');
});

test('extractDocId: pulls id from a Sheets URL', () => {
  const url = 'https://docs.google.com/spreadsheets/d/abcDEF1234567890/edit#gid=0';
  assert.equal(extractDocId(url), 'abcDEF1234567890');
});

test('extractDocId: pulls id from a Slides URL', () => {
  const url = 'https://docs.google.com/presentation/d/PRES_ID-9876/edit';
  assert.equal(extractDocId(url), 'PRES_ID-9876');
});

test('extractDocId: returns null for non-doc URLs', () => {
  assert.equal(extractDocId('https://example.com/file/d/foo'), null);
  assert.equal(extractDocId(''), null);
  assert.equal(extractDocId(null), null);
});

test('extractDocId: rejects ids shorter than 10 chars', () => {
  assert.equal(extractDocId('https://docs.google.com/document/d/short/edit'), null);
});

// ── extractSheetsId ─────────────────────────────────────────────────────────
test('extractSheetsId: only matches spreadsheets URLs', () => {
  assert.equal(
    extractSheetsId('https://docs.google.com/spreadsheets/d/SHEET-12345/edit'),
    'SHEET-12345'
  );
  assert.equal(
    extractSheetsId('https://docs.google.com/document/d/DOC-12345/edit'),
    null
  );
});

// ── detectGoogleUrl ─────────────────────────────────────────────────────────
test('detectGoogleUrl: finds zero, one, or many Google Docs URLs', () => {
  assert.deepEqual(detectGoogleUrl('no link here'), []);

  const single = 'see https://docs.google.com/document/d/abc1234567/edit thanks';
  assert.deepEqual(detectGoogleUrl(single), [
    'https://docs.google.com/document/d/abc1234567/edit',
  ]);

  const multi =
    'A https://docs.google.com/document/d/abc1234567/edit and B https://docs.google.com/spreadsheets/d/xyz0987654/edit';
  assert.equal(detectGoogleUrl(multi).length, 2);
});

test('detectGoogleUrl: ignores non-google URLs', () => {
  assert.deepEqual(detectGoogleUrl('https://example.com/foo'), []);
});

// ── interpolate ─────────────────────────────────────────────────────────────
test('interpolate: replaces {{vars}} with values', () => {
  assert.equal(interpolate('hi {{name}}', { name: 'Alice' }), 'hi Alice');
});

test('interpolate: supports nested keys', () => {
  assert.equal(
    interpolate('Task: {{task.text}} for {{task.assignee}}', {
      task: { text: 'Ship v2', assignee: 'Bob' },
    }),
    'Task: Ship v2 for Bob'
  );
});

test('interpolate: leaves unknown keys as literal placeholders', () => {
  assert.equal(interpolate('hi {{missing}}', {}), 'hi {{missing}}');
});

test('interpolate: tolerates undefined vars object', () => {
  assert.equal(interpolate('hi {{x}}', undefined), 'hi {{x}}');
});

test('interpolate: coerces numeric / boolean values to strings', () => {
  assert.equal(interpolate('count={{n}} ok={{b}}', { n: 7, b: true }), 'count=7 ok=true');
});

// ── isValidPriority / isValidTaskStatus ─────────────────────────────────────
test('isValidPriority: accepts only known priorities', () => {
  for (const p of PRIORITIES) assert.equal(isValidPriority(p), true);
  for (const p of ['urgent', '', null, undefined, 'HIGH']) {
    assert.equal(isValidPriority(p), false);
  }
});

test('isValidTaskStatus: accepts only known statuses', () => {
  for (const s of TASK_STATUSES) assert.equal(isValidTaskStatus(s), true);
  for (const s of ['done', 'open', '', null, undefined, 'Pending']) {
    assert.equal(isValidTaskStatus(s), false);
  }
});

// ── mkId / now ──────────────────────────────────────────────────────────────
test('mkId: returns a UUID-shaped string', () => {
  const id = mkId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('mkId: returns unique values across calls', () => {
  const ids = new Set(Array.from({ length: 50 }, () => mkId()));
  assert.equal(ids.size, 50);
});

test('now: returns a parseable ISO timestamp', () => {
  const ts = now();
  assert.ok(!Number.isNaN(Date.parse(ts)));
  assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});
