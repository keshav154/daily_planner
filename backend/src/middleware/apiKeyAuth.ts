import { Request, Response, NextFunction } from 'express';
import { User } from '../models/Schemas';

export interface ApiKeyRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export const authenticateApiKey = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    if (!apiKey || typeof apiKey !== 'string') {
      return res.status(401).json({ error: 'API key is missing. Use x-api-key header or apiKey query parameter.' });
    }

    const user = await User.findOne({ apiKey });
    if (!user) {
      return res.status(401).json({ error: 'Invalid API key.' });
    }

    (req as any).userId = user._id.toString();
    (req as any).userEmail = user.email;

    next();
  } catch (error: any) {
    console.error('API key auth error:', error);
    res.status(500).json({ error: 'Authentication failed.' });
  }
};
