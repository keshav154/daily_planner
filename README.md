# Aether Planner — AI Agentic Daily Planner

Aether Planner is a premium, minimal, dark-themed daily productivity app that goes beyond static checklists. Powered by an agentic loop running on Anthropic Claude (or an intelligent offline fallback), the application observes your behaviors, suggests scheduling time blocks, prompts you to break down complex goals, aggregates your logs, and extracts durable memory insights that refine future suggestions.

---

## Technical Architecture

The workspace is configured as a monorepo consisting of:
1. **Frontend (`/frontend`)**: Built using **Vite + React + TypeScript + Tailwind CSS v4**. It features smooth typography (Outfit/Inter), glassmorphic panels, and transitions powered by **Framer Motion**, and statistical reports charted with **Recharts**.
2. **Backend (`/backend`)**: Built using **Node.js + Express + TypeScript + Mongoose**. It manages simple single-user JWT authorization, Task/Log APIs, and structures the AI Observe-Plan-Act-Reflect loop.
3. **Database**: **MongoDB** collections:
   - `users`: Track timezone, working hours, and energy peaks.
   - `tasks`: Track status (`todo`, `in-progress`, `done`, `skipped`), priority (`high`, `medium`, `low`), estimated vs actual durations, order values, and source (`manual` vs `agent-suggested`).
   - `logs`: Append-only work audit entries representing duration, notes, and task progress.
   - `agent_memories`: Durable learned insights (e.g. "writing tasks take 40% longer") that can be accepted or dismissed by the user.
   - `agent_runs`: History logs of the observe-plan-act loop iterations for transparent auditing.

---

## Core Agentic Loop

Aether Planner implements a true stateful feedback cycle:
- **Observe**: The agent reads the user's timezone, working-hour preferences, today's schedule, overdue tasks, today's work logs, and previously learned memories.
- **Plan**: Claude processes the context snapshot to build a daily agenda, order priority queues, schedule morning time blocks during peak energy hours, and identify vague goals that require subtask splits.
- **Act**: Actions are saved as pending suggestions. The user maintains complete control and can **Accept** or **Dismiss** recommendations (which mutates database tasks or task order in real-time).
- **Reflect**: Periodic triggers analyze task completions vs estimates. The agent writes a summary, extracts performance insights (e.g., estimation margins), and proposes them as new durable items for the user's `agent_memory` store.

---

## Local Quick Start

### 1. Prerequisites
- **Node.js** (v18 or higher recommended)
- **MongoDB** running locally (`mongodb://localhost:27017`) or a MongoDB Atlas Cluster connection URI.

### 2. Environment Configurations
Rename `.env.example` in the root (or create `/backend/.env`) and define:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/daily-planner
JWT_SECRET=your_jwt_secret_key_here
# Get your Claude API Key from: console.anthropic.com
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```
*(Note: If `ANTHROPIC_API_KEY` is omitted, the planner runs in offline mode using localized rule-based heuristics so the app remains fully functional).*

### 3. Running the Server (Backend)
```bash
cd backend
npm install
npm run dev     # Starts local server on port 5000
npm run test    # Runs vitest test suite
```

### 4. Running the Client (Frontend)
```bash
cd ../frontend
npm install --legacy-peer-deps
npm run dev     # Starts local Vite client on port 5173
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Cloud Deployment Recommendations (Free/Low-Cost)

To deploy Aether Planner to the cloud, use the following combination:

### 1. Database: MongoDB Atlas (Free Tier)
- Sign up for [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) and create a free **M0 Sandbox** cluster.
- In the Network Access settings, allow access from everywhere (`0.0.0.0/0`) since free hosting providers change dynamic IPs.
- Copy your connection string and substitute it for `MONGODB_URI`.

### 2. Backend: Node.js Agent (Free/Low-Cost Server)
Deploy `/backend` to one of these platforms:
- **Render** (Free Tier):
  - Connect your GitHub repository.
  - Create a **Web Service**, set the Root Directory to `backend`, Build Command to `npm install && npm run build`, and Start Command to `npm run start`.
  - Define environment variables (`MONGODB_URI`, `JWT_SECRET`, `ANTHROPIC_API_KEY`).
  - *Note: Render's free tier spins down after 15 minutes of inactivity, causing a 50-second spin-up delay on the first request.*
- **Railway** (Starter Tier):
  - Offers a cheap, pay-as-you-go model (comes with free credits).
  - Connect your GitHub repo, point it to `/backend`, and define environment variables. Instantly deploys without spin-down limits.
- **Fly.io** (Free Tier allowance):
  - Runs full Docker containers with a free allowance.
  - Run `fly launch` in the `/backend` directory to auto-scaffold a Docker configuration and deploy.

### 3. Frontend: Vite Static Site (Free Hosting)
Deploy `/frontend` to:
- **Vercel** (Free Tier):
  - Connect your repository, create a project, and set the Root Directory to `frontend`.
  - Vercel automatically detects Vite, sets the output directory to `dist`, and serves it over a global CDN.
  - Edit `frontend/src/services/api.ts` base URL to point to your deployed backend URL.
- **Netlify** (Free Tier):
  - Connect your repo, select `/frontend` as the base directory, build command `npm run build`, and output folder `dist`.
