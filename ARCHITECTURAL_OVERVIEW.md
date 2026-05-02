# Colliq: Architectural Overview & Innovation

Colliq is a next-generation "Agentic" collaboration platform designed to solve the problem of information overload in modern team communication.

## 🏗️ Architecture: The Micro-Monolith
Colliq is built on a **Stateless Micro-monolith** architecture, optimized for high-density deployment on **Google Cloud Run**.

- **Event-Driven Core**: Uses Socket.io for real-time bidirectional communication, with a centralized "State Store" that can be easily mapped to Firestore/Redis for multi-instance scaling.
- **Identity-Socket Mapping**: A security layer that binds user identities to active socket connections, preventing session hijacking or impersonation.
- **Stateless Design**: The backend is designed to handle container recycling gracefully, retrieving all operational secrets and logging configurations dynamically from GCP at startup.

## 🚀 Innovation: What’s New?
Traditional tools (Slack, Teams) are passive storage for messages. Colliq is **Active**:

1. **Native Agentic Pulse**: Built-in AI agents (powered by Gemini) don't just wait for queries. They observe channel flow to extract "Implicit Tasks" (e.g., recognizing "I'll handle the deployment" as a task and suggesting its creation).
2. **Contextual Synthesis**: Instead of scrolling through 200 messages, the **Channel Insights** engine provides a semantic summary of the last hour of activity.
3. **Workflow Native**: Automates repetitive team rituals (Standups, Doc Alerts, Task Status updates) through a built-in event-trigger system.

## 🛠️ The Tech Stack
- **Backend**: Node.js 20, Express, Socket.io, Winston (Logging).
- **Frontend**: Vanilla ES6+, CSS3 (Outfit/JetBrains Mono typography), Glassmorphic UI.
- **Security**: Helmet.js (strict CSP), Rate Limiting, Secret Manager rotation.

## ☁️ Google Cloud Platform (GCP) Usage
Colliq is "GCP Native," utilizing the full breadth of the enterprise stack:

| Service | Role in Colliq |
| :--- | :--- |
| **Vertex AI (Gemini)** | Real-time summarization, task suggestion, and sentiment analysis. |
| **Cloud Run** | Serverless compute with auto-scaling and health-check resilience. |
| **Secret Manager** | Secure storage and runtime injection of API keys and Service Accounts. |
| **Cloud Storage (GCS)** | Durable, high-availability storage for all shared team assets and files. |
| **Cloud Logging** | Centralized audit trails and operational visibility for all system events. |
| **Drive/Docs APIs** | Seamless embedding and unfurling of Google Workspace documents. |

## 🎯 Problem Statement Alignment
- **Problem**: Teams lose tasks in the "noise" of chat.
- **Solution**: Colliq uses AI to bridge the gap between **Conversation** and **Action**, ensuring every decision in chat is captured as an actionable task.
