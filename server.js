require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const winston = require('winston');
const { LoggingWinston } = require('@google-cloud/logging-winston');
const { Storage } = require('@google-cloud/storage');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 8080;
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'focused-outlook-495105-b7';

// --- Logging Setup ---
const loggingWinston = new LoggingWinston({
  projectId: PROJECT_ID,
  logName: 'agentic-collaboration-logs',
});

const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console(),
    // Add Cloud Logging only if in production or credentials exist
    ...(process.env.NODE_ENV === 'production' ? [loggingWinston] : []),
  ],
});

// --- Middleware ---
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for demo simplicity with CDNs
}));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- GCP Cloud Storage ---
const storage = new Storage({ projectId: PROJECT_ID });
const bucketName = process.env.GCS_BUCKET || `${PROJECT_ID}-docs`;

// --- GCP Secret Manager ---
const secretClient = new SecretManagerServiceClient();

async function getSecret(secretName) {
  try {
    const [version] = await secretClient.accessSecretVersion({
      name: `projects/${PROJECT_ID}/secrets/${secretName}/versions/latest`,
    });
    return version.payload.data.toString();
  } catch (err) {
    logger.warn(`Could not fetch secret ${secretName}, using fallback.`);
    return process.env[secretName] || 'fallback-secret-key';
  }
}

// --- Mock Data ---
let tasks = [
  { id: 1, text: 'Finalize Cloud Run deployment', status: 'pending' },
  { id: 2, text: 'Integrate Titan Security Key policy', status: 'completed' }
];

// --- API Endpoints ---

// Tasks CRUD
app.get('/api/tasks', (req, res) => {
  res.json(tasks);
});

app.post('/api/tasks', (req, res) => {
  const newTask = { id: tasks.length + 1, text: req.body.text, status: 'pending' };
  tasks.push(newTask);
  logger.info(`New task created: ${newTask.text}`);
  res.status(201).json(newTask);
});

app.patch('/api/tasks/:id', (req, res) => {
  const task = tasks.find(t => t.id === parseInt(req.params.id));
  if (task) {
    task.status = req.body.status || task.status;
    res.json(task);
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

// Status & Health
app.get('/api/status', (req, res) => {
  res.json({ 
    status: 'online', 
    environment: process.env.NODE_ENV || 'development',
    projectId: PROJECT_ID 
  });
});

// Mock File Upload (Cloud Storage)
app.post('/api/upload', async (req, res) => {
  logger.info('File upload initiated');
  // In a real app, use multer and pipe to storage.bucket(bucketName).file(filename).createWriteStream()
  res.json({ message: 'Upload simulation successful. In production, files are saved to GCS.' });
});

// AI Task Suggestions
app.get('/api/ai/suggest-tasks', async (req, res) => {
  logger.info('AI Task Suggestions requested');
  
  // Simulate AI extraction from chat history
  setTimeout(() => {
    res.json([
      { text: 'Review PR for GCS integration', priority: 'high' },
      { text: 'Schedule team sync for Q3 planning', priority: 'medium' }
    ]);
  }, 800);
});
app.get('/api/ai/summarize', async (req, res) => {
  const channel = req.query.channel || 'general';
  logger.info(`AI Summary requested for #${channel}`);
  
  // Simulate AI processing
  setTimeout(() => {
    res.json({ 
      summary: `This is an AI-generated summary for #${channel}. Key topics: Project status, Cloud Run deployment, and Team synergy.`,
      confidence: 0.98
    });
  }, 1000);
});

// --- Socket.io (Real-time Chat) ---
io.on('connection', (socket) => {
  logger.info(`User connected: ${socket.id}`);

  socket.on('join', (room) => {
    socket.join(room);
    logger.info(`User joined room: ${room}`);
  });

  socket.on('message', (data) => {
    // Broadcast to the room
    io.to(data.room).emit('message', {
      user: data.user,
      text: data.text,
      timestamp: new Date().toISOString()
    });
    logger.info(`Message in ${data.room}: ${data.text}`);
  });

  socket.on('disconnect', () => {
    logger.info('User disconnected');
  });
});

// Fallback for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  logger.info(`Robust Server running on port ${PORT}`);
});
