import { Router, Request, Response } from 'express';
import ScheduleTemplate from '../models/ScheduleTemplate';

const router = Router();

// GET all schedule templates
router.get('/templates', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const templates = await ScheduleTemplate.find({ userId });
    return res.json(templates);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST create a schedule template
router.post('/templates', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { name, isDefault, blocks } = req.body;

    if (isDefault) {
      // Clear default status of other templates
      await ScheduleTemplate.updateMany({ userId }, { isDefault: false });
    }

    const template = new ScheduleTemplate({
      userId,
      name,
      isDefault: !!isDefault,
      blocks: blocks || []
    });

    await template.save();
    return res.status(201).json(template);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

// PUT update a schedule template
router.put('/templates/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { name, isDefault, blocks } = req.body;

    if (isDefault) {
      // Clear default status of other templates
      await ScheduleTemplate.updateMany({ userId, _id: { $ne: req.params.id } }, { isDefault: false });
    }

    const template = await ScheduleTemplate.findOneAndUpdate(
      { _id: req.params.id, userId },
      { name, isDefault: !!isDefault, blocks },
      { new: true, runValidators: true }
    );

    if (!template) {
      return res.status(404).json({ error: 'Schedule template not found' });
    }
    return res.json(template);
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

// DELETE a schedule template
router.delete('/templates/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const template = await ScheduleTemplate.findOneAndDelete({ _id: req.params.id, userId });
    if (!template) {
      return res.status(404).json({ error: 'Schedule template not found' });
    }
    return res.json({ message: 'Schedule template deleted' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
