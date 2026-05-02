'use strict';

const crypto = require('crypto');

const MAX_TEXT_LEN = 4000;

const PRIORITIES = ['high', 'medium', 'low'];
const TASK_STATUSES = ['pending', 'in-progress', 'completed'];

function sanitize(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim()
    .slice(0, MAX_TEXT_LEN);
}

function validateString(val, min = 1, max = 255) {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  return trimmed.length >= min && trimmed.length <= max;
}

function avatarOf(name) {
  return String(name == null ? '' : name)
    .split(' ')
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function extractDocId(url) {
  const match = String(url).match(
    /\/(?:document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]{10,})/
  );
  return match ? match[1] : null;
}

function extractSheetsId(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}

function detectGoogleUrl(text) {
  return String(text).match(/https?:\/\/docs\.google\.com\/[^\s"<>]+/g) || [];
}

function interpolate(template, vars) {
  return String(template).replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
    const val = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), vars);
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

function isValidPriority(p) {
  return PRIORITIES.includes(p);
}

function isValidTaskStatus(s) {
  return TASK_STATUSES.includes(s);
}

const mkId = () => crypto.randomUUID();
const now = () => new Date().toISOString();

module.exports = {
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
};
