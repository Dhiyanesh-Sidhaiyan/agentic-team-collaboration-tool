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
const { VertexAI } = require('@google-cloud/vertexai');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 8080;
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'focused-outlook-495105-b7';

// --- Logging Setup ---
let loggingWinston;
try {
  loggingWinston = new LoggingWinston({
    projectId: PROJECT_ID,
    logName: 'agentic-collaboration-logs',
  });
} catch (e) {
  console.warn('Could not initialize LoggingWinston:', e);
}

const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console(),
    // Add Cloud Logging only if in production and it initialized successfully
    ...(process.env.NODE_ENV === 'production' && loggingWinston ? [loggingWinston] : []),
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
let storage, secretClient, vertexModel;

try {
  storage = new Storage({ projectId: PROJECT_ID });
} catch(e) { logger.warn('Storage initialization failed:', e.message); }
const bucketName = process.env.GCS_BUCKET || `${PROJECT_ID}-docs`;

// --- GCP Secret Manager ---
try {
  secretClient = new SecretManagerServiceClient();
} catch(e) { logger.warn('SecretManager initialization failed:', e.message); }

// --- Vertex AI Setup ---
try {
  const vertexAI = new VertexAI({
    project: PROJECT_ID,
    location: 'us-central1',
  });
  vertexModel = vertexAI.getGenerativeModel({
    model: 'gemini-pro',
  });
} catch (e) {
  logger.warn('Vertex AI initialization failed:', e.message);
}

async function getSecret(secretName) {
  try {
    if (!secretClient) throw new Error("Secret client not initialized");
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
  if (vertexModel) {
    try {
      const prompt = 'Extract 2 concise actionable tasks from this context for a team collaboration tool. Format as a JSON array of objects with "text" and "priority" fields. Example: [{"text": "Review PR", "priority": "high"}]. Context: We need to finalize the Cloud Run deployment and setup the Titan Security Key.';
      const result = await vertexModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });
      const textResponse = result.response.candidates[0].content.parts[0].text;
      
      // Attempt to parse JSON response
      let parsedTasks;
      try {
        const jsonMatch = textResponse.match(/\[.*\]/s);
        parsedTasks = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch (err) {}
      
      if (parsedTasks && Array.isArray(parsedTasks)) {
        return res.json(parsedTasks);
      }
    } catch (err) {
      logger.error('Vertex AI error:', err.message);
    }
  }

  // Fallback
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
  
  if (vertexModel) {
    try {
      const result = await vertexModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: `Summarize the recent activity for the ${channel} channel.` }] }]
      });
      return res.json({ 
        summary: result.response.candidates[0].content.parts[0].text,
        confidence: 0.95
      });
    } catch (err) {
      logger.error('Vertex AI error:', err.message);
    }
  }

  // Fallback
  setTimeout(() => {
    res.json({ 
      summary: `This is a fallback AI-generated summary for #${channel}. Key topics: Project status, Cloud Run deployment, and Team synergy.`,
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

// Global error handler to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

server.listen(PORT, '0.0.0.0', () => {
  logger.info(`Robust Server running on port ${PORT}`);
});
