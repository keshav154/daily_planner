import { Router, Request, Response } from 'express';
import { Task } from '../models/Schemas';
import RecurringEvent from '../models/RecurringEvent';

const router = Router();

const formatICalDate = (date: Date): string => {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
};

// GET /ical export file
router.get('/ical', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const tasks = await Task.find({ userId, status: { $ne: 'skipped' } });
    const recurringEvents = await RecurringEvent.find({ userId, isActive: true });

    let icalString = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Kortex//Daily Planner//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ].join('\r\n') + '\r\n';

    // 1. Export Scheduled Tasks (those with time blocks)
    tasks.forEach(task => {
      if (task.timeBlock) {
        try {
          const taskDate = task.dueDate.toISOString().split('T')[0];
          const start = new Date(`${taskDate}T${task.timeBlock.startTime}:00Z`);
          const end = new Date(`${taskDate}T${task.timeBlock.endTime}:00Z`);

          icalString += [
            'BEGIN:VEVENT',
            `UID:task_${task._id}@kortex.planner`,
            `DTSTAMP:${formatICalDate(new Date())}`,
            `DTSTART:${formatICalDate(start)}`,
            `DTEND:${formatICalDate(end)}`,
            `SUMMARY:${task.title}`,
            `DESCRIPTION:${task.description || 'Task scheduled on Kortex'}`,
            `CATEGORIES:${task.category || 'Work'}`,
            'END:VEVENT'
          ].join('\r\n') + '\r\n';
        } catch (err) {
          // Skip malformed dates
        }
      }
    });

    // 2. Export Recurring Events
    recurringEvents.forEach(event => {
      // Create a recurring instance example for the next 30 days
      const pattern = event.recurrence.pattern;
      let rrule = '';

      if (pattern === 'daily') {
        rrule = 'FREQ=DAILY';
      } else if (pattern === 'weekdays') {
        rrule = 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR';
      } else if (pattern === 'weekly') {
        const days = event.recurrence.daysOfWeek.map(d => {
          const names = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
          return names[d];
        }).join(',');
        rrule = `FREQ=WEEKLY;BYDAY=${days}`;
      } else if (pattern === 'biweekly') {
        const days = event.recurrence.daysOfWeek.map(d => {
          const names = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
          return names[d];
        }).join(',');
        rrule = `FREQ=WEEKLY;INTERVAL=2;BYDAY=${days}`;
      } else if (pattern === 'monthly') {
        rrule = 'FREQ=MONTHLY';
      }

      if (event.recurrence.endDate) {
        const untilStr = event.recurrence.endDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        rrule += `;UNTIL=${untilStr}`;
      }

      try {
        const baseDate = new Date();
        const baseDateStr = baseDate.toISOString().split('T')[0];
        const start = new Date(`${baseDateStr}T${event.startTime}:00Z`);
        const end = new Date(`${baseDateStr}T${event.endTime}:00Z`);

        icalString += [
          'BEGIN:VEVENT',
          `UID:recurring_${event._id}@kortex.planner`,
          `DTSTAMP:${formatICalDate(new Date())}`,
          `DTSTART:${formatICalDate(start)}`,
          `DTEND:${formatICalDate(end)}`,
          `RRULE:${rrule}`,
          `SUMMARY:${event.title}`,
          `DESCRIPTION:${event.description || 'Recurring event scheduled on Kortex'}`,
          event.location ? `LOCATION:${event.location}` : '',
          `CATEGORIES:${event.category || 'Work'}`,
          'END:VEVENT'
        ].filter(Boolean).join('\r\n') + '\r\n';
      } catch (err) {
        // Skip malformed templates
      }
    });

    icalString += 'END:VCALENDAR';

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="kortex_schedule.ics"');
    return res.send(icalString);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
