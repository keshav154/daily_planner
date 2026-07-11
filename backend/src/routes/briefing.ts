import { Router, Request, Response } from 'express';
import { buildDailyBriefing } from '../services/briefingService';

const router = Router();

router.get('/daily', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const result = await buildDailyBriefing(userId);
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
