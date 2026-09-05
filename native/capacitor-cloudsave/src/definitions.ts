/**
 * Contract shared with the game (src/services/CloudSave.ts, `CloudSavePlugin`).
 * Keep the two in step.
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
}
