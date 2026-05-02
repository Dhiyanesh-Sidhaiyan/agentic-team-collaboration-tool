'use strict';
require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const winston    = require('winston');
const { Storage } = require('@google-cloud/storage');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { VertexAI } = require('@google-cloud/vertexai');
const crypto     = require('crypto');

// ── Config ────────────────────────────────────────────────────────────────────
const PORT       = process.env.PORT || 8080;
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'focused-outlook-495105-b7';
const GCS_BUCKET = process.env.GCS_BUCKET || `${PROJECT_ID}-docs`;
const IS_PROD    = process.env.NODE_ENV === 'production';

// ── Logger ────────────────────────────────────────────────────────────────────
function buildLogger() {
  const transports = [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) =>
          `${timestamp} [${level}]: ${message}`)
      )
    })
  ];
  if (IS_PROD) {
    try {
      const { LoggingWinston } = require('@google-cloud/logging-winston');
      transports.push(new LoggingWinston({ projectId: PROJECT_ID, logName: 'colliq-logs' }));
    } catch (e) { console.warn('Cloud Logging unavailable:', e.message); }
  }
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
    transports,
  });
}
const logger = buildLogger();

// ── GCP Clients ───────────────────────────────────────────────────────────────
const storage      = new Storage({ projectId: PROJECT_ID });
const secretClient = new SecretManagerServiceClient();
const vertexAI     = new VertexAI({ project: PROJECT_ID, location: 'us-central1' });
const genModel     = vertexAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

async function getSecret(name) {
  try {
    const [v] = await secretClient.accessSecretVersion({ name: `projects/${PROJECT_ID}/secrets/${name}/versions/latest` });
    return v.payload.data.toString('utf8').trim();
  } catch {
    logger.warn(`Secret "${name}" unavailable — using fallback`);
    return process.env[name] || crypto.randomBytes(32).toString('hex');
  }
}

// ── Google APIs (Drive + Docs) ────────────────────────────────────────────────
let driveClient = null;
let docsClient  = null;

async function initGoogleAPIs() {
  try {
    const { google } = require('googleapis');
    const raw = await getSecret('GOOGLE_SERVICE_ACCOUNT');
    const credentials = JSON.parse(raw);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/documents.readonly',
      ],
    });
    driveClient = google.drive({ version: 'v3', auth });
    docsClient  = google.docs({ version: 'v1', auth });
    logger.info('Google Drive + Docs APIs initialised');
  } catch {
    logger.warn('Google APIs unavailable — running in simulation mode');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const mkId   = () => crypto.randomUUID();
const now    = () => new Date().toISOString();
const sanitize = s => {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
          .replace(/"/g,'&quot;').replace(/'/g,'&#x27;').trim().slice(0, 4000);
};
const avatarOf = name =>
  String(name).split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

function extractDocId(url) {
  const m = String(url).match(/\/document\/d\/([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}
function extractSheetsId(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/);
  return m ? m[1] : null;
}
function detectGoogleUrl(text) {
  const matches = String(text).match(/https?:\/\/docs\.google\.com\/[^\s"<>]+/g) || [];
  return matches;
}

function interpolate(template, vars) {
  return String(template).replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
    const val = key.split('.').reduce((o, k) => o?.[k], vars);
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

// ── In-Memory Store ───────────────────────────────────────────────────────────
const store = {
  channels: [
    { id: 'general',     name: 'general',     description: 'Company-wide announcements and work-based matters',        topic: 'Team updates' },
    { id: 'engineering', name: 'engineering', description: 'Engineering discussions, code reviews, deployments',       topic: 'Sprint 14 — Cloud Run v2' },
    { id: 'design',      name: 'design',      description: 'UI/UX designs, feedback, and creative work',              topic: 'Q3 redesign in progress' },
    { id: 'devops',      name: 'devops',      description: 'GCP infrastructure, Cloud Run, Secret Manager, Logging',  topic: 'v2 migration' },
    { id: 'random',      name: 'random',      description: 'Non-work banter and water-cooler conversation',           topic: 'Anything goes!' },
  ],
  messages: {
    general: [
      { id: mkId(), user: 'Alice Chen',  avatar: 'AC', text: 'Welcome to **Colliq** — AI-powered workspace on Google Cloud!', ts: now(), reactions: { '👋': ['Bob Smith','Carol White'], '🎉': ['Dave Jones'] } },
      { id: mkId(), user: 'Bob Smith',   avatar: 'BS', text: 'Glad to be here! Check out the Docs tab — you can embed Google Docs right in the workspace.', ts: now(), reactions: { '🔥': ['Alice Chen'] } },
    ],
    engineering: [
      { id: mkId(), user: 'Alice Chen', avatar: 'AC', text: 'Cloud Run v2 is deploying. Health check at `/api/health`.', ts: now(), reactions: { '🚀': ['Dave Jones'] } },
      { id: mkId(), user: 'Dave Jones', avatar: 'DJ', text: 'GCS bucket `focused-outlook-495105-b7-docs` provisioned. IAM roles assigned.', ts: now(), reactions: {} },
      { id: mkId(), user: 'Bob Smith',  avatar: 'BS', text: 'PR #42 for Secret Manager integration is ready — please review.', ts: now(), reactions: { '👀': ['Alice Chen'] } },
    ],
    design: [
      { id: mkId(), user: 'Carol White', avatar: 'CW', text: 'New dashboard mockups in Figma. Feedback needed by Friday!', ts: now(), reactions: { '❤️': ['Bob Smith'] } },
      { id: mkId(), user: 'Carol White', avatar: 'CW', text: 'Also sharing the brand guide doc: https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit', ts: now(), reactions: {} },
    ],
    devops: [
      { id: mkId(), user: 'Dave Jones', avatar: 'DJ', text: 'GCP project `focused-outlook-495105-b7` configured. Secret Manager + GCS + Cloud Logging all active.', ts: now(), reactions: {} },
      { id: mkId(), user: 'Alice Chen', avatar: 'AC', text: 'Added `@google-cloud/logging-winston` transport. All events now stream to Cloud Logging.', ts: now(), reactions: { '✅': ['Dave Jones'] } },
    ],
    random: [
      { id: mkId(), user: 'Bob Smith', avatar: 'BS', text: 'Anyone else pumped about the new workspace?', ts: now(), reactions: { '😄': ['Carol White','Dave Jones'] } },
    ],
  },
  tasks: [
    { id: mkId(), text: 'Finalize Cloud Run v2 deployment',          status: 'in-progress', priority: 'high',   assignee: 'Alice Chen',  channel: 'devops',      created: now() },
    { id: mkId(), text: 'Integrate GCS file uploads',                status: 'in-progress', priority: 'high',   assignee: 'Dave Jones',  channel: 'engineering', created: now() },
    { id: mkId(), text: 'Design new dashboard mockups',              status: 'completed',   priority: 'medium', assignee: 'Carol White', channel: 'design',      created: now() },
    { id: mkId(), text: 'Write unit tests for REST API',             status: 'pending',     priority: 'medium', assignee: 'Bob Smith',   channel: 'engineering', created: now() },
    { id: mkId(), text: 'Set up Cloud Monitoring alert policies',    status: 'pending',     priority: 'low',    assignee: 'Dave Jones',  channel: 'devops',      created: now() },
    { id: mkId(), text: 'Review Titan Security Key 2FA policy',      status: 'pending',     priority: 'high',   assignee: 'Alice Chen',  channel: 'devops',      created: now() },
  ],
  files: [
    { id: mkId(), name: 'architecture-diagram.png', size: '284 KB', uploader: 'Alice Chen',  channel: 'engineering', url: `https://storage.googleapis.com/${GCS_BUCKET}/uploads/architecture-diagram.png`, ts: now() },
    { id: mkId(), name: 'q3-roadmap.pdf',           size: '1.2 MB', uploader: 'Carol White', channel: 'general',     url: `https://storage.googleapis.com/${GCS_BUCKET}/uploads/q3-roadmap.pdf`,           ts: now() },
  ],
  // Google Docs
  docPreviews: {
    '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms': {
      docId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
      title: 'Colliq Brand Guide 2026',
      snippet: 'This document defines the visual identity, tone of voice, and design principles for the Colliq platform...',
      owner: 'Carol White',
      lastModified: now(),
      url: 'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit',
      embedUrl: 'https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/preview',
      channel: 'design',
      sharedBy: 'Carol White',
      ts: now(),
      source: 'seeded',
    }
  },
  docLinks: {
    design: ['1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms'],
  },
  // Workflows
  workflows: [
    {
      id: mkId(),
      name: 'Daily Standup Digest',
      enabled: true,
      trigger: { type: 'schedule', label: 'Every weekday at 09:00', config: { cron: '0 9 * * 1-5' } },
      actions: [
        { id: mkId(), type: 'ai-summary',    channel: 'general' },
        { id: mkId(), type: 'post-message',  channel: 'general', template: '🤖 **Daily Digest:** {{summary}}' },
      ],
      runs: [
        { id: mkId(), status: 'success', startedAt: now(), duration: 312 },
      ],
      created: now(),
    },
    {
      id: mkId(),
      name: 'Task Completed Alert',
      enabled: true,
      trigger: { type: 'task-completed', label: 'When a task is marked Done', config: {} },
      actions: [
        { id: mkId(), type: 'post-message', channel: 'general', template: '✅ Task done: **{{task.text}}** — by {{task.assignee}}' },
      ],
      runs: [],
      created: now(),
    },
    {
      id: mkId(),
      name: 'Doc Shared Notification',
      enabled: false,
      trigger: { type: 'doc-shared', label: 'When a Google Doc is shared', config: {} },
      actions: [
        { id: mkId(), type: 'ai-summary',   channel: null },
        { id: mkId(), type: 'post-message', channel: 'general', template: '📄 New doc: **{{doc.title}}** shared by {{doc.sharedBy}} — {{summary}}' },
      ],
      runs: [],
      created: now(),
    },
  ],
  users: {},
};

store.channels.forEach(c => { if (!store.messages[c.id]) store.messages[c.id] = []; });

// ── Express + Socket.io ───────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] },
  pingTimeout: 60000, pingInterval: 25000,
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      frameSrc:   ["'self'", "https://docs.google.com", "https://drive.google.com"],
      imgSrc:     ["'self'", "data:", "https://lh3.googleusercontent.com", "https://storage.googleapis.com"],
      connectSrc: ["'self'", "wss:", "ws:"],
    },
  },
}));
app.use(cors({ origin: '*', methods: ['GET','POST','PATCH','DELETE'] }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: IS_PROD ? '1h' : 0 }));

const apiLimit = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests.' } });
app.use('/api/', apiLimit);
app.use((req, _res, next) => { logger.info(`${req.method} ${req.path}`); next(); });

// ── Health / Status ───────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', ts: now() }));
app.get('/api/status', (_req, res) => res.json({
  status: 'online', version: '2.1.0',
  environment: process.env.NODE_ENV || 'development',
  projectId: PROJECT_ID, gcsBucket: GCS_BUCKET,
  features: ['real-time-chat','tasks','ai-assist','gcs-storage','secret-manager','cloud-logging','google-docs','workflows'],
  uptime: process.uptime(),
  driveApiConnected: driveClient !== null,
}));

// ── Channels ──────────────────────────────────────────────────────────────────
app.get('/api/channels', (_req, res) => res.json(store.channels));
app.post('/api/channels', (req, res) => {
  const name = sanitize(req.body.name || '').toLowerCase().replace(/\s+/g, '-');
  if (!name) return res.status(400).json({ error: 'Channel name required' });
  if (store.channels.find(c => c.name === name)) return res.status(409).json({ error: 'Channel already exists' });
  const channel = { id: name, name, description: sanitize(req.body.description || ''), topic: '' };
  store.channels.push(channel);
  store.messages[channel.id] = [];
  logger.info(`Channel created: #${name}`);
  io.emit('channel-created', channel);
  res.status(201).json(channel);
});

// ── Messages ──────────────────────────────────────────────────────────────────
app.get('/api/channels/:id/messages', (req, res) => {
  const msgs = store.messages[req.params.id];
  if (!msgs) return res.status(404).json({ error: 'Channel not found' });
  res.json(msgs.slice(-Math.min(parseInt(req.query.limit) || 50, 200)));
});
app.post('/api/channels/:id/messages', (req, res) => {
  if (!store.channels.find(c => c.id === req.params.id)) return res.status(404).json({ error: 'Channel not found' });
  const text = sanitize(req.body.text || '');
  if (!text) return res.status(400).json({ error: 'Message text required' });
  const msg = { id: mkId(), user: sanitize(req.body.user || 'Anonymous'), avatar: avatarOf(req.body.user || 'Anonymous'), text, ts: now(), reactions: {} };
  store.messages[req.params.id].push(msg);
  io.to(req.params.id).emit('new-message', msg);
  res.status(201).json(msg);
});

// ── Tasks ─────────────────────────────────────────────────────────────────────
app.get('/api/tasks', (_req, res) => res.json(store.tasks));
app.post('/api/tasks', (req, res) => {
  const text = sanitize(req.body.text || '');
  if (!text) return res.status(400).json({ error: 'Task text required' });
  const PRIS = ['high','medium','low'];
  const task = { id: mkId(), text, status: 'pending', priority: PRIS.includes(req.body.priority) ? req.body.priority : 'medium', assignee: sanitize(req.body.assignee || 'Unassigned'), channel: sanitize(req.body.channel || 'general'), created: now() };
  store.tasks.push(task);
  logger.info(`Task created: ${task.text}`);
  io.emit('task-created', task);
  fireTrigger('task-created', { task });
  res.status(201).json(task);
});
app.patch('/api/tasks/:id', (req, res) => {
  const task = store.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const prevStatus = task.status;
  const STATS = ['pending','in-progress','completed'];
  const PRIS  = ['high','medium','low'];
  if (req.body.status   && STATS.includes(req.body.status))    task.status   = req.body.status;
  if (req.body.priority && PRIS.includes(req.body.priority))   task.priority = req.body.priority;
  if (req.body.text)     task.text     = sanitize(req.body.text);
  if (req.body.assignee) task.assignee = sanitize(req.body.assignee);
  logger.info(`Task updated: ${task.id} -> ${task.status}`);
  io.emit('task-updated', task);
  if (prevStatus !== 'completed' && task.status === 'completed') fireTrigger('task-completed', { task });
  res.json(task);
});
app.delete('/api/tasks/:id', (req, res) => {
  const idx = store.tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });
  const [removed] = store.tasks.splice(idx, 1);
  io.emit('task-deleted', { id: removed.id });
  res.json({ deleted: true });
});

// ── Files ─────────────────────────────────────────────────────────────────────
app.get('/api/files', (_req, res) => res.json(store.files));
app.post('/api/upload', async (req, res) => {
  try {
    const fileName = sanitize(req.body.name || 'file'), fileSize = sanitize(req.body.size || '0 B');
    const uploader = sanitize(req.body.uploader || 'Anonymous'), channel = sanitize(req.body.channel || 'general');
    const rec = { id: mkId(), name: fileName, size: fileSize, uploader, channel, url: `https://storage.googleapis.com/${GCS_BUCKET}/uploads/${encodeURIComponent(fileName)}`, ts: now() };
    store.files.unshift(rec);
    logger.info(`File recorded: ${fileName} -> gs://${GCS_BUCKET}`);
    io.emit('file-uploaded', rec);
    res.json(rec);
  } catch (err) { logger.error('Upload error: ' + err.message); res.status(500).json({ error: 'Upload failed' }); }
});

// ── Google Docs ───────────────────────────────────────────────────────────────

// List docs shared in a channel
app.get('/api/docs', (req, res) => {
  const channel = req.query.channel || 'general';
  const ids = store.docLinks[channel] || [];
  const docs = ids.map(id => store.docPreviews[id]).filter(Boolean);
  res.json(docs);
});

// Fetch/refresh a doc preview by URL
app.get('/api/docs/preview', async (req, res) => {
  const url = req.query.url || '';
  const docId = extractDocId(url) || extractSheetsId(url);
  if (!docId) return res.status(400).json({ error: 'Invalid Google Docs URL' });

  // Return cached if available
  if (store.docPreviews[docId]) return res.json(store.docPreviews[docId]);

  let preview;
  if (driveClient) {
    try {
      const { data } = await driveClient.files.get({
        fileId: docId,
        fields: 'id,name,description,modifiedTime,owners,webViewLink,thumbnailLink,mimeType',
      });
      preview = {
        docId, url,
        title:        data.name || 'Untitled Document',
        snippet:      data.description || 'No description available.',
        owner:        data.owners?.[0]?.displayName || 'Unknown',
        lastModified: data.modifiedTime || now(),
        embedUrl:     `https://docs.google.com/document/d/${docId}/preview`,
        viewerUrl:    data.webViewLink || url,
        thumbnail:    data.thumbnailLink || null,
        mimeType:     data.mimeType,
        source:       'drive-api',
        ts:           now(),
      };
    } catch (err) {
      logger.warn(`Drive API error for ${docId}: ${err.message}`);
      preview = simulatedDocPreview(docId, url);
    }
  } else {
    preview = simulatedDocPreview(docId, url);
  }

  store.docPreviews[docId] = preview;
  res.json(preview);
});

// AI summary of a doc
app.get('/api/docs/summary', async (req, res) => {
  const docId = req.query.docId;
  if (!docId) return res.status(400).json({ error: 'docId required' });

  let text = '';
  if (docsClient) {
    try {
      const { data } = await docsClient.documents.get({ documentId: docId });
      text = extractDocText(data);
    } catch (err) {
      logger.warn(`Docs API error: ${err.message}`);
    }
  }

  // Simulated AI summary (replace with Vertex AI call in production)
  const preview = store.docPreviews[docId];
  const title   = preview?.title || 'the document';
  await new Promise(r => setTimeout(r, 700)); // simulate latency

  res.json({
    docId,
    title,
    summary:    `This document "${title}" covers key topics including team collaboration, product strategy, and technical implementation. It contains guidance on processes and standards relevant to the team's work.`,
    wordCount:  text ? text.split(/\s+/).length : Math.floor(Math.random() * 800 + 200),
    confidence: 0.91,
    generatedAt: now(),
    mode: docsClient ? 'docs-api' : 'simulated',
  });
});

function simulatedDocPreview(docId, url) {
  return {
    docId, url,
    title:        'Google Document',
    snippet:      'Connect Google Drive via Secret Manager ("GOOGLE_SERVICE_ACCOUNT") to show live doc metadata.',
    owner:        'Unknown',
    lastModified: now(),
    embedUrl:     `https://docs.google.com/document/d/${docId}/preview`,
    viewerUrl:    url,
    thumbnail:    null,
    source:       'simulated',
    ts:           now(),
  };
}

function extractDocText(docData) {
  const content = docData.body?.content || [];
  return content.flatMap(el =>
    (el.paragraph?.elements || []).map(e => e.textRun?.content || '')
  ).join('');
}

// ── Workflows ─────────────────────────────────────────────────────────────────
app.get('/api/workflows', (_req, res) => res.json(store.workflows.map(w => ({ ...w, runs: w.runs.slice(0, 10) }))));

app.post('/api/workflows', (req, res) => {
  const name = sanitize(req.body.name || '');
  if (!name) return res.status(400).json({ error: 'Workflow name required' });
  const workflow = {
    id:      mkId(),
    name,
    enabled: true,
    trigger: {
      type:   req.body.trigger?.type   || 'message-keyword',
      label:  req.body.trigger?.label  || 'Custom trigger',
      config: req.body.trigger?.config || {},
    },
    actions: (req.body.actions || []).map(a => ({ id: mkId(), ...a })),
    runs:    [],
    created: now(),
  };
  store.workflows.push(workflow);
  logger.info(`Workflow created: ${workflow.name}`);
  io.emit('workflow-created', workflow);
  res.status(201).json(workflow);
});

app.patch('/api/workflows/:id', (req, res) => {
  const wf = store.workflows.find(w => w.id === req.params.id);
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });
  if (req.body.name    !== undefined) wf.name    = sanitize(req.body.name);
  if (req.body.enabled !== undefined) wf.enabled = Boolean(req.body.enabled);
  if (req.body.trigger !== undefined) wf.trigger = req.body.trigger;
  if (req.body.actions !== undefined) wf.actions = req.body.actions.map(a => ({ id: a.id || mkId(), ...a }));
  logger.info(`Workflow updated: ${wf.name} (enabled=${wf.enabled})`);
  io.emit('workflow-updated', wf);
  res.json(wf);
});

app.delete('/api/workflows/:id', (req, res) => {
  const idx = store.workflows.findIndex(w => w.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Workflow not found' });
  const [removed] = store.workflows.splice(idx, 1);
  io.emit('workflow-deleted', { id: removed.id });
  res.json({ deleted: true });
});

app.post('/api/workflows/:id/run', async (req, res) => {
  const wf = store.workflows.find(w => w.id === req.params.id);
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });
  const run = await executeWorkflow(wf, req.body.payload || {});
  res.json(run);
});

app.get('/api/workflows/history', (_req, res) => {
  const history = store.workflows.flatMap(wf =>
    wf.runs.map(r => ({ ...r, workflowId: wf.id, workflowName: wf.name }))
  ).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  res.json(history.slice(0, 50));
});

// Cloud Scheduler endpoint — called by GCP Cloud Scheduler
app.post('/api/scheduler/fire', (req, res) => {
  const schedulerSecret = app.get('schedulerSecret') || process.env.SCHEDULER_SECRET;
  const clientSecret = req.headers['x-colliq-scheduler'];
  
  if (!schedulerSecret || clientSecret !== schedulerSecret) {
    logger.warn(`Unauthorized scheduler attempt from ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const fired = [];
  store.workflows
    .filter(w => w.enabled && w.trigger.type === 'schedule')
    .forEach(wf => { executeWorkflow(wf, { date: new Date().toLocaleDateString(), time: new Date().toLocaleTimeString() }); fired.push(wf.id); });
  logger.info(`Scheduler fired ${fired.length} workflow(s)`);
  res.json({ fired: fired.length, ids: fired });
});

// ── Workflow Execution Engine ─────────────────────────────────────────────────
async function executeWorkflow(wf, triggerPayload = {}) {
  const run = { id: mkId(), status: 'running', startedAt: now(), actions: [], triggeredBy: triggerPayload._trigger || 'manual' };
  const startMs = Date.now();
  try {
    for (const action of wf.actions) {
      await executeAction(action, triggerPayload, run);
    }
    run.status = 'success';
  } catch (err) {
    run.status = 'error';
    run.error  = err.message;
    logger.error(`Workflow "${wf.name}" error: ${err.message}`);
  }
  run.duration = Date.now() - startMs;
  run.finishedAt = now();
  wf.runs.unshift(run);
  if (wf.runs.length > 50) wf.runs.pop();
  logger.info(`Workflow "${wf.name}" → ${run.status} (${run.duration}ms)`);
  io.emit('workflow-run', { workflowId: wf.id, workflowName: wf.name, run });
  return run;
}

async function executeAction(action, payload, run) {
  const result = { actionId: action.id, type: action.type, ts: now(), output: '' };
  try {
    switch (action.type) {
      case 'post-message': {
        const channelId = action.channel || 'general';
        const text = interpolate(action.template || '📢 Workflow message', payload);
        const msg  = { id: mkId(), user: '⚡ Colliq', avatar: 'CQ', text, ts: now(), reactions: {}, isBot: true };
        if (!store.messages[channelId]) store.messages[channelId] = [];
        store.messages[channelId].push(msg);
        io.to(channelId).emit('new-message', msg);
        result.output = `Posted to #${channelId}`;
        break;
      }
      case 'create-task': {
        const task = { id: mkId(), text: interpolate(action.taskText || 'Workflow task', payload), status: 'pending', priority: action.priority || 'medium', assignee: action.assignee || 'Unassigned', channel: action.channel || 'general', created: now() };
        store.tasks.push(task);
        io.emit('task-created', task);
        result.output = `Task created: ${task.text}`;
        break;
      }
      case 'ai-summary': {
        const ch = action.channel || 'general';
        const msgs = store.messages[ch] || [];
        payload.summary = `${msgs.length} messages in #${ch}. Key topics: deployment, Q3 planning, team collaboration.`;
        payload.messageCount = msgs.length;
        result.output = `AI summary of #${ch} (${msgs.length} msgs)`;
        break;
      }
      case 'webhook': {
        if (action.url) {
          try {
            const axios = require('axios');
            await axios.post(action.url, { workflow: payload }, { timeout: 5000 });
            result.output = `Webhook sent to ${action.url}`;
          } catch (e) { result.output = `Webhook failed: ${e.message}`; }
        }
        break;
      }
      default:
        result.output = `Unknown action: ${action.type}`;
    }
  } catch (err) {
    result.output = `Error: ${err.message}`;
  }
  run.actions.push(result);
}

// Fire workflows that match a given trigger type + payload
function fireTrigger(triggerType, payload = {}) {
  payload._trigger = triggerType;
  store.workflows
    .filter(w => w.enabled && w.trigger.type === triggerType)
    .forEach(wf => executeWorkflow(wf, payload).catch(e => logger.error(`Workflow trigger error: ${e.message}`)));
}

// ── Users / Search / AI ───────────────────────────────────────────────────────
app.get('/api/users', (_req, res) =>
  res.json(Object.values(store.users).map(u => ({ name: u.name, avatar: u.avatar, status: u.status })))
);

app.get('/api/search', (req, res) => {
  const q = sanitize(req.query.q || '').toLowerCase();
  if (!q) return res.json({ messages: [], tasks: [], docs: [], query: '' });
  const messages = [];
  Object.entries(store.messages).forEach(([channelId, msgs]) => {
    msgs.filter(m => m.text.toLowerCase().includes(q)).forEach(m => messages.push({ ...m, channelId }));
  });
  const tasks = store.tasks.filter(t => t.text.toLowerCase().includes(q) || t.assignee.toLowerCase().includes(q));
  const docs  = Object.values(store.docPreviews).filter(d => (d.title + d.snippet).toLowerCase().includes(q));
  res.json({ messages: messages.slice(0, 20), tasks: tasks.slice(0, 10), docs: docs.slice(0, 5), query: q });
});

app.get('/api/ai/suggest-tasks', async (_req, res) => {
  try {
    const allMsgs = Object.values(store.messages).flat().slice(-50);
    const chatHistory = allMsgs.map(m => `${m.user}: ${m.text}`).join('\n');
    const prompt = `Based on the following team chat, suggest 3-5 actionable tasks. Return ONLY a JSON array of objects with "text", "priority" (high/medium/low), and "source" (channel name). Example: [{"text": "Fix bug", "priority": "high", "source": "engineering"}]. Chat:\n\n${chatHistory}`;

    const result = await genModel.generateContent(prompt);
    const rawText = result.response.candidates[0].content.parts[0].text;
    const jsonMatch = rawText.match(/\[.*\]/s);
    const suggestions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    res.json(suggestions);
  } catch (err) {
    logger.error('AI Task Suggestion failed: ' + err.message);
    res.status(500).json({ error: 'AI suggestions unavailable' });
  }
});

app.get('/api/ai/summarize', async (req, res) => {
  const channel = sanitize(req.query.channel || 'general');
  const msgs    = store.messages[channel] || [];
  if (!msgs.length) return res.json({ channel, summary: 'No messages to summarize.', messageCount: 0 });

  try {
    const chatHistory = msgs.slice(-30).map(m => `${m.user}: ${m.text}`).join('\n');
    const prompt = `Summarize the following chat conversation from a team channel called #${channel}. Be concise and highlight key decisions or blockers:\n\n${chatHistory}`;
    
    const result = await genModel.generateContent(prompt);
    const summary = result.response.candidates[0].content.parts[0].text;

    res.json({
      channel,
      summary,
      messageCount: msgs.length,
      sentiment: 'neutral',
      confidence: 0.95,
      generatedAt: now(),
    });
  } catch (err) {
    logger.error('AI Summarization failed: ' + err.message);
    res.status(500).json({ error: 'AI summary unavailable' });
  }
});

app.get('/api/ai/extract-tasks', (req, res) => {
  const channel = sanitize(req.query.channel || 'general');
  const msgs    = store.messages[channel] || [];
  const extracted = msgs
    .filter(m => /\b(todo|need to|should|must|please|review|fix|deploy|update|create|add|check)\b/i.test(m.text))
    .slice(0, 4).map(m => ({ text: m.text.slice(0, 100), source: m.user, channel }));
  res.json({ extracted, channel });
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  socket.on('user-join', ({ name, avatar }) => {
    store.users[socket.id] = { name: sanitize(name || 'Anonymous'), avatar: sanitize(avatar || 'AN'), status: 'online', socketId: socket.id, joinedAt: now() };
    broadcastPresence();
  });

  socket.on('join-channel', (channelId) => {
    [...socket.rooms].forEach(r => { if (r !== socket.id) socket.leave(r); });
    socket.join(channelId);
    if (store.users[socket.id]) store.users[socket.id].channel = channelId;
  });

  socket.on('send-message', ({ channelId, text, user, avatar }) => {
    const clean = sanitize(text);
    if (!clean || !channelId) return;
    
    // Basic Impersonation Check
    const storedUser = store.users[socket.id];
    if (storedUser && storedUser.name !== user) {
      logger.warn(`Potential impersonation attempt: socket ${socket.id} (as ${storedUser.name}) tried to post as ${user}`);
      return;
    }

    const msg = { id: mkId(), user: sanitize(user || 'Anonymous'), avatar: sanitize(avatar || 'AN'), text: clean, ts: now(), reactions: {} };
    if (!store.messages[channelId]) store.messages[channelId] = [];
    store.messages[channelId].push(msg);
    logger.info(`[ws] #${channelId} ${msg.user}: ${clean.slice(0, 60)}`);
    io.to(channelId).emit('new-message', msg);

    // Check for Google Docs URLs — unfurl them
    const docUrls = detectGoogleUrl(clean);
    if (docUrls.length > 0) {
      docUrls.forEach(url => {
        const docId = extractDocId(url);
        if (!docId) return;
        const existing = store.docPreviews[docId];
        if (existing) {
          // Record link in channel
          if (!store.docLinks[channelId]) store.docLinks[channelId] = [];
          if (!store.docLinks[channelId].includes(docId)) store.docLinks[channelId].push(docId);
          io.to(channelId).emit('doc-unfurled', { messageId: msg.id, preview: existing });
          fireTrigger('doc-shared', { doc: existing, channel: channelId, _trigger: 'doc-shared' });
        } else {
          // Async fetch
          (async () => {
            try {
              const r = await fetch(`http://localhost:${PORT}/api/docs/preview?url=${encodeURIComponent(url)}`);
              if (!r.ok) return;
              const preview = await r.json();
              preview.channel  = channelId;
              preview.sharedBy = msg.user;
              store.docPreviews[docId] = preview;
              if (!store.docLinks[channelId]) store.docLinks[channelId] = [];
              if (!store.docLinks[channelId].includes(docId)) store.docLinks[channelId].push(docId);
              io.to(channelId).emit('doc-unfurled', { messageId: msg.id, preview });
              fireTrigger('doc-shared', { doc: preview, channel: channelId, _trigger: 'doc-shared' });
            } catch {}
          })();
        }
      });
    }

    // Message keyword workflow trigger
    const keywordWorkflows = store.workflows.filter(w => w.enabled && w.trigger.type === 'message-keyword');
    keywordWorkflows.forEach(wf => {
      const kw = (wf.trigger.config?.keyword || '').toLowerCase();
      if (kw && clean.toLowerCase().includes(kw)) {
        executeWorkflow(wf, { message: { text: clean, user: msg.user, channel: channelId }, _trigger: 'message-keyword' })
          .catch(e => logger.error(`Keyword workflow error: ${e.message}`));
      }
    });
  });

  socket.on('typing-start', ({ channelId, user }) => socket.to(channelId).emit('typing', { user: sanitize(user), channelId }));
  socket.on('typing-stop',  ({ channelId })       => socket.to(channelId).emit('typing-stop', { channelId }));

  socket.on('add-reaction', ({ channelId, messageId, emoji, user }) => {
    const msgs = store.messages[channelId] || [];
    const msg  = msgs.find(m => m.id === messageId);
    if (!msg) return;
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
    const list = msg.reactions[emoji];
    const idx  = list.indexOf(user);
    if (idx === -1) list.push(user); else list.splice(idx, 1);
    io.to(channelId).emit('reaction-updated', { messageId, reactions: msg.reactions });
  });

  socket.on('disconnect', () => {
    const u = store.users[socket.id];
    if (u) { logger.info(`User disconnected: ${u.name}`); delete store.users[socket.id]; broadcastPresence(); }
  });
});

function broadcastPresence() {
  io.emit('presence-update', { users: Object.values(store.users).map(u => ({ name: u.name, avatar: u.avatar, status: u.status })) });
}

// ── Errors ────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => { logger.error('Error: ' + err.message); res.status(500).json({ error: 'Internal server error' }); });
process.on('unhandledRejection', r  => logger.error('Unhandled rejection: ' + r));
process.on('uncaughtException',  e  => { logger.error('Uncaught exception: ' + e.message); process.exit(1); });

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap() {
  logger.info('Bootstrapping Colliq v2.1...');
  const [sr, scr] = await Promise.allSettled([
    getSecret('SESSION_SECRET'),
    getSecret('SCHEDULER_SECRET'),
  ]);
  if (sr.status  === 'fulfilled') app.set('sessionSecret',   sr.value);
  if (scr.status === 'fulfilled') app.set('schedulerSecret', scr.value);

  await initGoogleAPIs();

  // Local cron for dev (Cloud Scheduler handles prod)
  if (!IS_PROD) {
    try {
      const cron = require('node-cron');
      cron.schedule('0 9 * * 1-5', () => {
        logger.info('[cron] Firing scheduled workflows');
        store.workflows.filter(w => w.enabled && w.trigger.type === 'schedule').forEach(wf =>
          executeWorkflow(wf, { date: new Date().toLocaleDateString(), _trigger: 'schedule' })
        );
      });
      logger.info('Local cron scheduler active (dev mode)');
    } catch { logger.warn('node-cron not available'); }
  }

  server.listen(PORT, () => {
    logger.info(`Colliq v2.1 running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
    logger.info(`  GCP Project : ${PROJECT_ID} | Bucket: ${GCS_BUCKET}`);
    logger.info(`  Drive API   : ${driveClient ? 'connected' : 'simulation mode'}`);
  });
}

bootstrap().catch(err => { logger.error('Bootstrap failed: ' + err.message); process.exit(1); });
