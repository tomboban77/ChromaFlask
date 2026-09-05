/**
 * Achievements: milestones over the lifetime stats the save already keeps.
 *
 * Pure data plus a predicate each, so the list is trivially testable and the
 * app only has to ask "which of these are true now?" after each win. Rewards
 * are small: a badge with a tip, not a second income.
 */

export interface AchievementView {
  readonly wins: number;
  readonly perfects: number;
  readonly pours: number;
  readonly bestWinStreak: number;
  readonly bestDailyStreak: number;
  readonly campaignCleared: number;
  readonly campaignStars: number;
  readonly chaptersDone: number;
  readonly endlessCleared: number;
  readonly campaignSize: number;
}

export interface Achievement {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly coins: number;
  readonly test: (v: AchievementView) => boolean;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first_pour', name: 'First Pour', desc: 'Clear your first level', coins: 25,
    test: (v) => v.wins >= 1 },
  { id: 'perfect_1', name: 'Precise', desc: 'Earn three stars on a level', coins: 25,
    test: (v) => v.perfects >= 1 },
  { id: 'perfect_10', name: 'Steady Hand', desc: 'Ten perfect clears', coins: 75,
    test: (v) => v.perfects >= 10 },
  { id: 'perfect_50', name: 'Master Alchemist', desc: 'Fifty perfect clears', coins: 200,
    test: (v) => v.perfects >= 50 },
  { id: 'chapter_1', name: 'Apprentice', desc: 'Complete the first chapter', coins: 50,
    test: (v) => v.chaptersDone >= 1 },
  { id: 'chapter_5', name: 'Journeyman', desc: 'Complete five chapters', coins: 100,
    test: (v) => v.chaptersDone >= 5 },
  { id: 'chapter_13', name: 'Adept', desc: 'Complete thirteen chapters', coins: 200,
    test: (v) => v.chaptersDone >= 13 },
  { id: 'campaign', name: 'The Grand Elixir', desc: 'Clear every campaign level', coins: 500,
    test: (v) => v.campaignCleared >= v.campaignSize },
  { id: 'stars_100', name: 'Constellation', desc: 'Collect 100 stars', coins: 75,
    test: (v) => v.campaignStars >= 100 },
  { id: 'stars_500', name: 'Galaxy', desc: 'Collect 500 stars', coins: 200,
    test: (v) => v.campaignStars >= 500 },
  { id: 'stars_all', name: 'Every Star', desc: 'Three stars on every campaign level', coins: 1000,
    test: (v) => v.campaignStars >= v.campaignSize * 3 },
  { id: 'streak_5', name: 'On a Roll', desc: 'Win five levels in a row', coins: 50,
    test: (v) => v.bestWinStreak >= 5 },
  { id: 'streak_15', name: 'Unstoppable', desc: 'Win fifteen levels in a row', coins: 150,
    test: (v) => v.bestWinStreak >= 15 },
  { id: 'daily_7', name: 'Regular', desc: 'A seven-day daily challenge streak', coins: 100,
    test: (v) => v.bestDailyStreak >= 7 },
  { id: 'daily_30', name: 'Devoted', desc: 'A thirty-day daily challenge streak', coins: 400,
    test: (v) => v.bestDailyStreak >= 30 },
  { id: 'pours_1000', name: 'Thousand Pours', desc: 'Pour a thousand times', coins: 75,
    test: (v) => v.pours >= 1000 },
  { id: 'endless_10', name: 'Beyond the Map', desc: 'Clear ten endless levels', coins: 100,
    test: (v) => v.endlessCleared >= 10 },
];

/** Ids of every achievement whose condition holds for this view. */
export function unlockedAchievements(v: AchievementView): string[] {
  return ACHIEVEMENTS.filter((a) => a.test(v)).map((a) => a.id);
}

export function achievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
