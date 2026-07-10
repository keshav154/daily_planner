import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/Schemas';

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  // 1. If JWT token is present, verify it
  if (token) {
    const secret = process.env.JWT_SECRET || 'dev_jwt_secret_key_daily_planner_agent_2026';
    jwt.verify(token, secret, (err: any, decoded: any) => {
      if (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
      }
      req.userId = decoded.userId;
      next();
    });
    return;
  }

  // 2. Fallback to API Key authentication
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (apiKey && typeof apiKey === 'string') {
    try {
      const user = await User.findOne({ apiKey });
      if (!user) {
        return res.status(401).json({ error: 'Invalid API key.' });
      }
      req.userId = user._id.toString();
      (req as any).userEmail = user.email;
      next();
      return;
    } catch (error) {
      console.error('API key auth error in fallback:', error);
      return res.status(500).json({ error: 'Authentication failed.' });
    }
  }

  // 3. Neither present
  return res.status(401).json({ error: 'Access token or API key required' });
};
