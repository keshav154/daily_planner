import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/Schemas';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Register a new user
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, timezone, preferences } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = new User({
      email: email.toLowerCase(),
      passwordHash,
      timezone: timezone || 'UTC',
      preferences: preferences || {}
    });

    await user.save();

    const secret = process.env.JWT_SECRET || 'dev_jwt_secret_key_daily_planner_agent_2026';
    const token = jwt.sign({ userId: user._id }, secret, { expiresIn: '7d' });

    res.status(201).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        timezone: user.timezone,
        preferences: user.preferences
      }
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const secret = process.env.JWT_SECRET || 'dev_jwt_secret_key_daily_planner_agent_2026';
    const token = jwt.sign({ userId: user._id }, secret, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        timezone: user.timezone,
        preferences: user.preferences
      }
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// Get current user profile
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.userId).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error: any) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to retrieve profile' });
  }
});

// Update user profile (theme, preferences, etc.)
router.put('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { timezone, preferences, theme } = req.body;
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (timezone) user.timezone = timezone;
    if (theme) user.theme = theme;
    if (preferences) {
      user.preferences = {
        ...user.preferences,
        ...preferences
      };
    }

    await user.save();
    
    // Return updated user without password hash
    const updatedUser = await User.findById(req.userId).select('-passwordHash');
    return res.json(updatedUser);
  } catch (error: any) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

export default router;
