/**
 * Chapters: the campaign in 25 named blocks of 20 levels.
 *
 * Purely structural - the level curve does not know about chapters. They give
 * the 500-level map a sense of place (headers, progress, a completion moment
 * with a coin bonus) and the win screen something better to say than a
 * random level name. Pure data, so the core stays engine-free.
 */
import { LEVEL_COUNT } from './levels';

export const CHAPTER_SIZE = 20;

export interface Chapter {
  /** 1-based chapter number. */
  readonly index: number;
  readonly first: number;
  readonly last: number;
  readonly name: string;
  /** CSS colour for the chapter's header accent. */
  readonly accent: string;
}

/** An alchemist's journey, one room at a time. */
const NAMES: readonly string[] = [
  'First Pour',
  "Apprentice's Bench",
  'Amber Cellar',
  'Misty Vials',
  'Cauldron Row',
  'Murky Depths',
  'Crystal Gallery',
  'Velvet Vault',
  'Stormglass Tower',
  'Gilded Alembic',
  'Emerald Still',
  'Moonlit Distillery',
  'Cinder Kitchen',
  'Frozen Apothecary',
  'Royal Laboratory',
  'Blazing Forge',
  'Silent Archive',
  'Cosmic Observatory',
  'Molten Foundry',
  'Radiant Sanctum',
  'Ancient Catacombs',
  'Bubbling Marsh',
  'Twisted Spire',
  'Golden Athenaeum',
  'The Grand Elixir',
];

/** The liquid palette, so chapter accents feel like the potions themselves. */
const ACCENTS: readonly string[] = [
  '#22d3ee', '#a855f7', '#ffb020', '#2bd97c', '#ff6fb5', '#4f7cff', '#f5365c', '#c8e64a',
];

export const CHAPTERS: readonly Chapter[] = Array.from(
  { length: Math.ceil(LEVEL_COUNT / CHAPTER_SIZE) },
  (_, i) => ({
    index: i + 1,
    first: i * CHAPTER_SIZE + 1,
    last: Math.min(LEVEL_COUNT, (i + 1) * CHAPTER_SIZE),
    name: NAMES[i] ?? `Chapter ${i + 1}`,
    accent: ACCENTS[i % ACCENTS.length] as string,
  }),
);

/** The chapter a campaign level belongs to; null for endless ids. */
export function chapterFor(id: number): Chapter | null {
  if (id < 1 || id > LEVEL_COUNT) return null;
  return CHAPTERS[Math.floor((id - 1) / CHAPTER_SIZE)] ?? null;
}

/** True for the last level of a chapter (where the completion bonus is paid). */
export function isChapterEnd(id: number): boolean {
  const ch = chapterFor(id);
  return ch !== null && id === ch.last;
}
