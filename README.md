# Colliq: Agentic Collaboration Platform

Colliq is an AI-powered workspace built for the **Engineering & Project Operations** vertical. It transforms team chat from a passive message store into an active assistant that synthesizes conversations, extracts hidden tasks, and automates team rituals using Google Cloud Platform.

## 🎯 Challenge Vertical: Engineering & Project Operations
In fast-paced engineering teams, critical decisions and tasks are often buried in long chat threads. Colliq addresses this by using Gemini AI to act as a "silent secretary," ensuring that no commitment made in chat is forgotten.

## 🚀 Key Features & Logic
### 1. Contextual AI Synthesis
Instead of reading 100+ messages, Colliq uses **Vertex AI (Gemini 1.5 Flash)** to generate "Pulse" summaries. It understands the sentiment and technical progress of a channel (e.g., `#engineering`, `#devops`) and provides a concise digest.

### 2. Implicit Task Extraction
The "Agentic" core scans messages for commitments like *"I'll check the logs"* or *"someone needs to update the docs"*. It identifies these as actionable tasks and suggests them to the user for one-click board management.

### 3. Automated Team Workflows
A built-in event engine allows teams to define triggers (e.g., "Every weekday at 9 AM" or "When a Google Doc is shared") to perform actions like posting summaries or firing webhooks.

## ☁️ Google Cloud Integration
| Service | Purpose |
| :--- | :--- |
| **Vertex AI (Gemini)** | Real-time workspace intelligence and task extraction. |
| **Cloud Run** | Stateless, auto-scaling hosting with secure network binding. |
| **Secret Manager** | Runtime orchestration of API keys and Service Account secrets. |
| **Cloud Storage** | Persistent, durable storage for team files and assets. |
| **Cloud Logging** | Enterprise-grade audit trails and operational visibility. |
| **Drive/Docs APIs** | Seamless unfurling and management of shared project documentation. |

## 🛡️ Security & Evaluation Focus
- **Code Quality**: Modular architecture with resilient error handling and dry initialization patterns.
- **Security**: Strict Content Security Policy (CSP), impersonation prevention via socket-identity mapping, and hardened API endpoints.
- **Efficiency**: Optimized Docker container size (<100MB) and stateless design for high-performance scaling.
- **Accessibility**: ARIA-compliant UI with semantic HTML5 and screen-reader optimized live regions.
- **Testing**: Built-in `audit.js` tool to verify GCP integrations and security headers.

## 🛠️ Installation & Usage
1. **Clone & Install**:
   ```bash
   npm install
   ```
2. **Setup Secrets**:
   Provide a `GOOGLE_SERVICE_ACCOUNT` secret in Secret Manager or a local `.env` file.
3. **Run**:
   ```bash
   npm start
   ```
4. **Test**:
   ```bash
   npm test
   ```

## 📝 Assumptions
- The application assumes a Google Cloud Project with Vertex AI and Secret Manager APIs enabled.
- For local development, it falls back to simulation mode if GCP credentials are not found.

---
**Built for the Google Antigravity Challenge 2024.**
