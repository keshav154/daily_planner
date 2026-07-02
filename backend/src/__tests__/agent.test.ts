import { describe, it, expect, vi } from 'vitest';
import { parseFallback } from '../agent/parser';
import { gatherUserContext } from '../agent/loop';

// Mock Mongoose models to prevent database connections during tests
vi.mock('../models/Schemas', () => {
  const mockTasks = [
    { _id: 'task1', title: 'Task 1', status: 'done', priority: 'high', estimatedTime: 60, actualTime: 60, createdAt: new Date() },
    { _id: 'task2', title: 'Task 2', status: 'todo', priority: 'medium', estimatedTime: 30, actualTime: 0, createdAt: new Date() }
  ];

  const mockLogs = [
    { title: 'Worked on Task 1', duration: 60, timestamp: new Date() }
  ];

  const mockMemories = [
    { content: 'Underestimates writing tasks by 40%', createdAt: new Date() }
  ];

  const createQueryMock = (data: any) => {
    const query: any = {
      sort: vi.fn().mockImplementation(() => query),
      limit: vi.fn().mockImplementation(() => query),
      then: vi.fn().mockImplementation((resolve) => resolve(data)),
      catch: vi.fn()
    };
    return query;
  };

  return {
    User: {
      findById: vi.fn().mockResolvedValue({
        _id: 'user123',
        email: 'test@example.com',
        timezone: 'America/New_York',
        preferences: {
          workingHoursStart: '09:00',
          workingHoursEnd: '17:00',
          peakEnergyTime: 'morning'
        }
      })
    },
    Task: {
      find: vi.fn().mockImplementation(() => createQueryMock(mockTasks)),
      findOne: vi.fn()
    },
    Log: {
      find: vi.fn().mockImplementation(() => createQueryMock(mockLogs))
    },
    AgentMemory: {
      find: vi.fn().mockImplementation(() => createQueryMock(mockMemories))
    },
    AgentRun: vi.fn()
  };
});

describe('Agent Natural Language Parser (Fallback Rules)', () => {
  it('should parse priority and estimated time from plain text', () => {
    const result = parseFallback('Finish writing high priority blog post for 2 hours #marketing');
    
    expect(result.priority).toBe('high');
    expect(result.estimatedTime).toBe(120); // 2 hours = 120 minutes
    expect(result.tags).toContain('marketing');
    expect(result.title).toContain('Finish writing');
  });

  it('should fallback to default values for basic inputs', () => {
    const result = parseFallback('buy groceries');
    
    expect(result.priority).toBe('medium');
    expect(result.estimatedTime).toBe(30);
    expect(result.category).toBe('Work');
  });
});

describe('Agent Context Observation', () => {
  it('should correctly aggregate logs, user profile, and compile stats', async () => {
    const context = await gatherUserContext('user123');

    expect(context.user.email).toBe('test@example.com');
    expect(context.user.timezone).toBe('America/New_York');
    expect(context.activeTasks).toHaveLength(2);
    expect(context.dailyLogs).toHaveLength(1);
    expect(context.memories).toHaveLength(1);
    expect(context.stats.completionRate).toBe(50); // 1 out of 2 completed
  });
});
