import { Injectable } from '@nestjs/common';
import { SpotifyTokenStore } from '../interfaces/token-store.interface';
import { SpotifyTokens } from '../interfaces/spotify.interface';

@Injectable()
export class TokenStoreService implements SpotifyTokenStore {
  private readonly store = new Map<string, SpotifyTokens>();

  async save(userId: string, tokens: SpotifyTokens): Promise<void> {
    this.store.set(userId, tokens);
  }

  async load(userId: string): Promise<SpotifyTokens | null> {
    return this.store.get(userId) ?? null;
  }
}
