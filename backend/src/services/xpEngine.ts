import { User } from '../models/Schemas';

export const XP_REWARDS = {
  COMPLETE_TASK: 10,
  COMPLETE_HIGH_PRIORITY: 25,
  COMPLETE_ALL_SUBTASKS: 15,
  FINISH_POMODORO: 20,
  SEVEN_DAY_STREAK: 100,
  COMPLETE_ALL_HABITS: 30,
  FIRST_TASK_OF_DAY: 5,
};

export const calculateLevel = (xp: number): number => {
  return Math.max(1, Math.floor(Math.sqrt(xp / 100)));
};

export const awardXP = async (
  userId: string,
  amount: number,
  reason: string
): Promise<{ xp: number; level: number; achievements: string[]; leveledUp: boolean }> => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const currentXP = user.xp || 0;
  const newXP = currentXP + amount;
  const currentLevel = user.level || 1;
  const newLevel = calculateLevel(newXP);

  user.xp = newXP;
  user.level = newLevel;

  const leveledUp = newLevel > currentLevel;

  await user.save();

  return {
    xp: user.xp,
    level: user.level,
    achievements: user.achievements || [],
    leveledUp
  };
};

export const checkAndAwardAchievement = async (
  userId: string,
  achievementId: string
): Promise<{ unlocked: boolean; achievements: string[] }> => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const achievements = user.achievements || [];
  if (achievements.includes(achievementId)) {
    return { unlocked: false, achievements };
  }

  achievements.push(achievementId);
  user.achievements = achievements;
  await user.save();

  return { unlocked: true, achievements };
};
