import { SpotifyTokens } from './spotify.interface';

export interface SpotifyTokenStore {
  save(userId: string, tokens: SpotifyTokens): Promise<void>;
  load(userId: string): Promise<SpotifyTokens | null>;
}
