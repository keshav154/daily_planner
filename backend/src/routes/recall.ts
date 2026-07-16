import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { searchHistory } from '../services/recall';

const router = Router();

// GET /api/recall?query=...&limit=8 — natural-language recall over the user's
// own work history (logs, task resolutions, memories). The "second brain"
// search: "what did I do about the ECM deployment on cusdemo?"
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const query = typeof req.query.query === 'string' ? req.query.query : '';
    const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit || '8'), 10) || 8));
    if (!query.trim()) return res.json({ results: [] });

    const results = await searchHistory(req.userId as string, query, limit);
    res.json({ results });
  } catch (error: any) {
    console.error('Recall search error:', error);
    res.status(500).json({ error: 'Failed to search history' });
  }
});

export default router;
