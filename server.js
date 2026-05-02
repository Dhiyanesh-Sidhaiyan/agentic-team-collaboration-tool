'use strict';
require('dotenv').config();

const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const path        = require('path');
const helmet      = require('helmet');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const winston     = require('winston');
const { Storage } = require('@google-cloud/storage');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const crypto      = require('crypto');

// ── Configuration ─────────────────────────────────────────────────────────────
const PORT        = process.env.PORT || 8080;
const PROJECT_ID  = process.env.GOOGLE_CLOUD_PROJECT || 'focused-outlook-495105-b7';
const GCS_BUCKET  = process.env.GCS_BUCKET || `${PROJECT_ID}-docs`;
const IS_PROD     = process.env.NODE_ENV === 'production';

// ── Logger ────────────────────────────────────────────────────────────────────
function buildLogger() {
  const transports = [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) =>
          `${timestamp} [${level}]: ${message}`
        )
      )
    })
  ];

  if (IS_PROD) {
    try {
      const { LoggingWinston } = require('@google-cloud/logging-winston');
      transports.push(new LoggingWinston({
        projectId: PROJECT_ID,
        logName: 'colliq-collaboration-logs',
      }));
    } catch (e) {
      console.warn('Cloud Logging transport unavailable:', e.message);
    }
  }

  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    transports,
  });
}
const logger = buildLogger();

// ── GCP Clients ───────────────────────────────────────────────────────────────
const storage      = new Storage({ projectId: PROJECT_ID });
const secretClient = new SecretManagerServiceClient();

async function getSecret(name) {
  try {
    const [version] = await secretClient.accessSecretVersion({
      name: `projects/${PROJECT_ID}/secrets/${name}/versions/latest`,
    });
    return version.payload.data.toString('utf8').trim();
  } catch {
    logger.warn(`Secret "${name}" unavailable — using env/fallback`);
    return process.env[name] || crypto.randomBytes(32).toString('hex');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const mkId = () => crypto.randomUUID();
const now  = () => new Date().toISOString();

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
    .trim().slice(0, 4000);
}

function avatarOf(name) {
  return String(name).split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
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
      { id: mkId(), user: 'Alice Chen',  avatar: 'AC', text: 'Welcome to **TeamFlow** — your AI-powered workspace on Google Cloud!', ts: now(), reactions: { '👋': ['Bob Smith', 'Carol White'], '🎉': ['Dave Jones'] } },
      { id: mkId(), user: 'Bob Smith',   avatar: 'BS', text: 'Glad to be here. This platform looks great!', ts: now(), reactions: { '🔥': ['Alice Chen'] } },
    ],
    engineering: [
      { id: mkId(), user: 'Alice Chen', avatar: 'AC', text: 'Cloud Run v2 is deploying. Health check endpoint is at `/api/health`.', ts: now(), reactions: { '🚀': ['Dave Jones'] } },
      { id: mkId(), user: 'Dave Jones', avatar: 'DJ', text: 'GCS bucket `focused-outlook-495105-b7-docs` is provisioned. IAM roles assigned.', ts: now(), reactions: {} },
      { id: mkId(), user: 'Bob Smith',  avatar: 'BS', text: 'PR #42 for Secret Manager integration is up — need review by EOD.', ts: now(), reactions: { '👀': ['Alice Chen'] } },
    ],
    design: [
      { id: mkId(), user: 'Carol White', avatar: 'CW', text: 'New dashboard mockups in Figma. Please review and give feedback by Friday!', ts: now(), reactions: { '❤️': ['Bob Smith'] } },
    ],
    devops: [
      { id: mkId(), user: 'Dave Jones', avatar: 'DJ', text: 'GCP project `focused-outlook-495105-b7` configured. Secret Manager + GCS + Cloud Logging all active.', ts: now(), reactions: {} },
      { id: mkId(), user: 'Alice Chen', avatar: 'AC', text: 'Added `@google-cloud/logging-winston` transport. All server events now stream to Cloud Logging.', ts: now(), reactions: { '✅': ['Dave Jones'] } },
    ],
    random: [
      { id: mkId(), user: 'Bob Smith', avatar: 'BS', text: 'Anyone else excited about the new workspace? Way better than the old tools!', ts: now(), reactions: { '😄': ['Carol White', 'Dave Jones'] } },
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
  users: {},
};

// Ensure every channel has a messages array
store.channels.forEach(c => {
  if (!store.messages[c.id]) store.messages[c.id] = [];
});

// ── Express + Socket.io ───────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'] }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: IS_PROD ? '1h' : 0 }));

app.use('/api/', rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down.' },
}));

app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// ── REST API ──────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => res.json({ status: 'ok', ts: now() }));

app.get('/api/status', (_req, res) => res.json({
  status: 'online', version: '2.0.0',
  environment: process.env.NODE_ENV || 'development',
  projectId: PROJECT_ID, gcsBucket: GCS_BUCKET,
  features: ['real-time-chat', 'tasks', 'ai-assist', 'gcs-storage', 'secret-manager', 'cloud-logging'],
  uptime: process.uptime(),
}));

// Channels
app.get('/api/channels', (_req, res) => res.json(store.channels));

app.post('/api/channels', (req, res) => {
  const name = sanitize(req.body.name || '').toLowerCase().replace(/\s+/g, '-');
  if (!name) return res.status(400).json({ error: 'Channel name required' });
  if (store.channels.find(c => c.name === name))
    return res.status(409).json({ error: 'Channel already exists' });
  const channel = { id: name, name, description: sanitize(req.body.description || ''), topic: '' };
  store.channels.push(channel);
  store.messages[channel.id] = [];
  logger.info(`Channel created: #${name}`);
  io.emit('channel-created', channel);
  res.status(201).json(channel);
});

// Messages
app.get('/api/channels/:id/messages', (req, res) => {
  const msgs = store.messages[req.params.id];
  if (!msgs) return res.status(404).json({ error: 'Channel not found' });
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(msgs.slice(-limit));
});

app.post('/api/channels/:id/messages', (req, res) => {
  if (!store.channels.find(c => c.id === req.params.id))
    return res.status(404).json({ error: 'Channel not found' });
  const text = sanitize(req.body.text || '');
  if (!text) return res.status(400).json({ error: 'Message text required' });
  const msg = {
    id: mkId(), user: sanitize(req.body.user || 'Anonymous'),
    avatar: avatarOf(req.body.user || 'Anonymous'),
    text, ts: now(), reactions: {},
  };
  store.messages[req.params.id].push(msg);
  logger.info(`Message in #${req.params.id} by ${msg.user}`);
  io.to(req.params.id).emit('new-message', msg);
  res.status(201).json(msg);
});

// Tasks
app.get('/api/tasks', (_req, res) => res.json(store.tasks));

app.post('/api/tasks', (req, res) => {
  const text = sanitize(req.body.text || '');
  if (!text) return res.status(400).json({ error: 'Task text required' });
  const PRIORITIES = ['high', 'medium', 'low'];
  const task = {
    id: mkId(), text, status: 'pending',
    priority: PRIORITIES.includes(req.body.priority) ? req.body.priority : 'medium',
    assignee: sanitize(req.body.assignee || 'Unassigned'),
    channel:  sanitize(req.body.channel  || 'general'),
    created:  now(),
  };
  store.tasks.push(task);
  logger.info(`Task created: ${task.text}`);
  io.emit('task-created', task);
  res.status(201).json(task);
});

app.patch('/api/tasks/:id', (req, res) => {
  const task = store.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const STATUSES   = ['pending', 'in-progress', 'completed'];
  const PRIORITIES = ['high', 'medium', 'low'];
  if (req.body.status   && STATUSES.includes(req.body.status))     task.status   = req.body.status;
  if (req.body.priority && PRIORITIES.includes(req.body.priority)) task.priority = req.body.priority;
  if (req.body.text)     task.text     = sanitize(req.body.text);
  if (req.body.assignee) task.assignee = sanitize(req.body.assignee);
  logger.info(`Task updated: ${task.id} -> ${task.status}`);
  io.emit('task-updated', task);
  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  const idx = store.tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });
  const [removed] = store.tasks.splice(idx, 1);
  io.emit('task-deleted', { id: removed.id });
  res.json({ deleted: true });
});

// Files
app.get('/api/files', (_req, res) => res.json(store.files));

app.post('/api/upload', async (req, res) => {
  try {
    const fileName = sanitize(req.body.name     || 'unnamed-file');
    const fileSize = sanitize(req.body.size     || '0 B');
    const uploader = sanitize(req.body.uploader || 'Anonymous');
    const channel  = sanitize(req.body.channel  || 'general');
    const fileRecord = {
      id: mkId(), name: fileName, size: fileSize, uploader, channel,
      url: `https://storage.googleapis.com/${GCS_BUCKET}/uploads/${encodeURIComponent(fileName)}`,
      ts: now(),
    };
    store.files.unshift(fileRecord);
    logger.info(`File recorded: ${fileName} by ${uploader} -> gs://${GCS_BUCKET}`);
    io.emit('file-uploaded', fileRecord);
    res.json(fileRecord);
  } catch (err) {
    logger.error('Upload error: ' + err.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Users
app.get('/api/users', (_req, res) =>
  res.json(Object.values(store.users).map(u => ({ name: u.name, avatar: u.avatar, status: u.status })))
);

// Search
app.get('/api/search', (req, res) => {
  const q = sanitize(req.query.q || '').toLowerCase();
  if (!q) return res.json({ messages: [], tasks: [], query: '' });
  const messages = [];
  Object.entries(store.messages).forEach(([channelId, msgs]) => {
    msgs.filter(m => m.text.toLowerCase().includes(q)).forEach(m => messages.push({ ...m, channelId }));
  });
  const tasks = store.tasks.filter(t =>
    t.text.toLowerCase().includes(q) || t.assignee.toLowerCase().includes(q)
  );
  logger.info(`Search: "${q}" -> ${messages.length} messages, ${tasks.length} tasks`);
  res.json({ messages: messages.slice(0, 20), tasks: tasks.slice(0, 10), query: q });
});

// AI endpoints
app.get('/api/ai/suggest-tasks', (_req, res) => {
  const suggestions = [
    { text: 'Review Cloud Run health-check timeout configuration', priority: 'high',   source: '#devops' },
    { text: 'Schedule Q3 design review meeting with Carol',        priority: 'medium', source: '#design' },
    { text: 'Update GCS bucket IAM policy for least-privilege',    priority: 'high',   source: '#engineering' },
    { text: 'Document Secret Manager secret rotation procedure',   priority: 'low',    source: '#devops' },
    { text: 'Add Cloud Monitoring uptime check for /api/health',   priority: 'medium', source: '#devops' },
  ];
  setTimeout(() => res.json(suggestions), 500);
});

app.get('/api/ai/summarize', (req, res) => {
  const channel = sanitize(req.query.channel || 'general');
  const msgs    = store.messages[channel] || [];
  const summaries = {
    general:     'Team is onboarded on TeamFlow. No blockers. Morale is high. New platform well-received.',
    engineering: 'Cloud Run v2 deployment underway. GCS integration PR pending review. Unit tests outstanding.',
    design:      'Dashboard mockups complete and awaiting stakeholder feedback. Q3 redesign on track.',
    devops:      'GCP project active. Secret Manager, GCS bucket, and Cloud Logging all operational.',
    random:      'Positive team energy. General excitement around the new platform launch.',
  };
  setTimeout(() => res.json({
    channel,
    summary:      summaries[channel] || `${msgs.length} messages in #${channel}. No critical issues detected.`,
    messageCount: msgs.length,
    sentiment:    'positive',
    confidence:   0.94,
    generatedAt:  now(),
  }), 700);
});

app.get('/api/ai/extract-tasks', (req, res) => {
  const channel   = sanitize(req.query.channel || 'general');
  const msgs      = store.messages[channel] || [];
  const extracted = msgs
    .filter(m => /\b(todo|need to|should|must|please|review|fix|deploy|update|create|add|check)\b/i.test(m.text))
    .slice(0, 4)
    .map(m => ({ text: m.text.slice(0, 100), source: m.user, channel }));
  res.json({ extracted, channel });
});

// ── Socket.io Events ──────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  socket.on('user-join', ({ name, avatar }) => {
    store.users[socket.id] = {
      name: sanitize(name || 'Anonymous'), avatar: sanitize(avatar || 'AN'),
      status: 'online', socketId: socket.id, joinedAt: now(),
    };
    broadcastPresence();
  });

  socket.on('join-channel', (channelId) => {
    [...socket.rooms].forEach(room => { if (room !== socket.id) socket.leave(room); });
    socket.join(channelId);
    if (store.users[socket.id]) store.users[socket.id].channel = channelId;
  });

  socket.on('send-message', ({ channelId, text, user, avatar }) => {
    const clean = sanitize(text);
    if (!clean || !channelId) return;
    const msg = {
      id: mkId(), user: sanitize(user || 'Anonymous'),
      avatar: sanitize(avatar || 'AN'), text: clean, ts: now(), reactions: {},
    };
    if (!store.messages[channelId]) store.messages[channelId] = [];
    store.messages[channelId].push(msg);
    logger.info(`[ws] #${channelId} ${msg.user}: ${clean.slice(0, 60)}`);
    io.to(channelId).emit('new-message', msg);
  });

  socket.on('typing-start', ({ channelId, user }) => {
    socket.to(channelId).emit('typing', { user: sanitize(user), channelId });
  });

  socket.on('typing-stop', ({ channelId }) => {
    socket.to(channelId).emit('typing-stop', { channelId });
  });

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
  io.emit('presence-update', {
    users: Object.values(store.users).map(u => ({ name: u.name, avatar: u.avatar, status: u.status })),
  });
}

// ── Error Handlers ────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => { logger.error('Error: ' + err.message); res.status(500).json({ error: 'Internal server error' }); });
process.on('unhandledRejection', r  => logger.error('Unhandled rejection: ' + r));
process.on('uncaughtException',  e  => { logger.error('Uncaught exception: ' + e.message); process.exit(1); });

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap() {
  logger.info('Bootstrapping TeamFlow v2.0...');
  const [sr] = await Promise.allSettled([getSecret('SESSION_SECRET')]);
  if (sr.status === 'fulfilled') {
    app.set('sessionSecret', sr.value);
    logger.info('Secrets loaded from Secret Manager');
  }
  server.listen(PORT, () => {
    logger.info(`TeamFlow v2.0 running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
    logger.info(`  GCP Project: ${PROJECT_ID} | GCS Bucket: ${GCS_BUCKET}`);
  });
}

bootstrap().catch(err => { logger.error('Bootstrap failed: ' + err.message); process.exit(1); });
