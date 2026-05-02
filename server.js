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

// --- API Endpoints ---

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

// AI Insights Simulation
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
