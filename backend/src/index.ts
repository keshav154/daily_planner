import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db';
import authRoutes from './routes/auth';
import taskRoutes from './routes/tasks';
import logRoutes from './routes/logs';
import agentRoutes from './routes/agent';
import recurringRoutes from './routes/recurring';
import scheduleRoutes from './routes/schedule';
import habitRoutes from './routes/habits';
import templateRoutes from './routes/templates';
import briefingRoutes from './routes/briefing';
import exportRoutes from './routes/exportRoutes';
import aiRoutes from './routes/aiRoutes';
import goalRoutes from './routes/goals';
import integrationRoutes from './routes/integration';
import memoryRoutes from './routes/memoryRoutes';
import notificationRoutes from './routes/notifications';
import { authenticateToken } from './middleware/auth';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to Database
connectDB();

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    // Reflect request origin (or allow serverless/CLI requests with undefined origin)
    callback(null, true);
  },
  credentials: true
}));
app.use(express.json());

// Base health check. Also doubles as the keep-alive target for an external
// uptime pinger (see .env.example) — the background scheduler is in-process,
// so on Render's free tier it stops ticking entirely whenever this process
// sleeps from inactivity.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Bind API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/recurring', authenticateToken, recurringRoutes);
app.use('/api/schedule', authenticateToken, scheduleRoutes);
app.use('/api/habits', authenticateToken, habitRoutes);
app.use('/api/templates', authenticateToken, templateRoutes);
app.use('/api/briefing', authenticateToken, briefingRoutes);
app.use('/api/export', authenticateToken, exportRoutes);
app.use('/api/ai', authenticateToken, aiRoutes);
app.use('/api/goals', authenticateToken, goalRoutes);
app.use('/api/integration', integrationRoutes);
app.use('/api/memories', memoryRoutes);
app.use('/api/notifications', notificationRoutes);

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

import { startBackgroundScheduler } from './services/backgroundPlanner';

// Start Server
app.listen(PORT, () => {
  console.log(`Daily Planner Agent Server running on port ${PORT}`);
  // Start background auto-planner checks
  startBackgroundScheduler();
});
