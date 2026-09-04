import type { SaveProfile } from './SaveService';

/**
 * Identity behind a driver seam. Today everything is a local guest profile;
 * adding OAuth later means implementing AuthDriver, not editing screens.
 */
export interface AuthDriver {
  readonly id: string;
  readonly canSyncCloud: boolean;
  signIn(displayName: string, avatar: string): Promise<SaveProfile>;
  signOut(): Promise<void>;
}

export class GuestAuthDriver implements AuthDriver {
  readonly id = 'guest';
  readonly canSyncCloud = false;

  async signIn(displayName: string, avatar: string): Promise<SaveProfile> {
    const name = displayName.trim().slice(0, 16) || 'Player';
    return { name, avatar, createdAt: Date.now() };
  }

  async signOut(): Promise<void> {
    /* nothing to revoke for a local profile */
  }
}

export class AuthService {
  constructor(private readonly driver: AuthDriver = new GuestAuthDriver()) {}

  get canSyncCloud(): boolean {
    return this.driver.canSyncCloud;
  }

  signIn(displayName: string, avatar: string): Promise<SaveProfile> {
    return this.driver.signIn(displayName, avatar);
  }

  signOut(): Promise<void> {
    return this.driver.signOut();
  }
}
