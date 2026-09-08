/**
 * Contract shared with the game (src/services/CloudSave.ts `CloudSavePlugin`,
 * src/services/Leaderboard.ts `LeaderboardPlugin`). Keep them in step.
 *
 * Despite the package name this plugin covers **platform game services**, not
 * only cloud save. Leaderboard lives here because on Android it needs exactly
 * the same Play Games sign-in as saved games; a second plugin would mean two
 * copies of the auth handling and two consent prompts for one account.
 */
export interface CloudSnapshot {
  /** Serialized SaveData. */
  data: string;
  /** Epoch ms when the device wrote it. */
  updatedAt: number;
  /** Human device label ("Pixel 8", "iPhone"). */
  device: string;
}

export interface CloudSavePlugin {
  // ---------------------------------------------------------- cloud save
  /** Whether this device could cloud-save at all. Never rejects. */
  isAvailable(): Promise<{ available: boolean }>;
  /** Account label already signed in, without UI. */
  currentAccount(): Promise<{ account: string | null }>;
  /** Interactive sign-in. `{ account: null }` means the player backed out. */
  signIn(): Promise<{ account: string | null }>;
  /** The single stored snapshot, or `data: null` when none exists. */
  load(): Promise<{ data: string | null; updatedAt: number; device: string }>;
  /** Overwrite the single snapshot. */
  store(snapshot: CloudSnapshot): Promise<void>;
  signOut(): Promise<void>;

  // ---------------------------------------------------------- leaderboard
  /**
   * Whether this device has a leaderboard system at all. Deliberately
   * separate from `isAvailable`: on iOS, Game Center and the iCloud key-value
   * store used by cloud save are unrelated, so one can work while the other
   * does not. Sign-in state is *not* part of this answer; it is handled per
   * call below.
   */
  isLeaderboardAvailable(): Promise<{ available: boolean }>;
  /**
   * Post a score. Resolves silently when the player is signed out - a score
   * post must never interrupt play with a sign-in sheet.
   */
  submitLeaderboardScore(options: { leaderboardId: string; score: number }): Promise<void>;
  /**
   * Open the platform's own leaderboard UI, signing in first if the player
   * agrees. `{ shown: false }` means they declined, which is not an error.
   */
  showLeaderboard(options: { leaderboardId: string }): Promise<{ shown: boolean }>;
}
