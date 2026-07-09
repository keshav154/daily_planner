import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { getRelevantMemories } from '../services/similarity';

const router = Router();

// GET /relevant
router.get('/relevant', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { query } = req.query;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const searchQuery = typeof query === 'string' ? query : '';
    const memories = await getRelevantMemories(userId, searchQuery, 3);
    
    res.json(memories);
  } catch (error: any) {
    console.error('Relevant memories fetch error:', error);
    res.status(500).json({ error: 'Failed to retrieve semantic context' });
  }
});

export default router;
