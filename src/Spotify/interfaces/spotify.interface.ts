export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface SpotifyTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export interface SpotifyTrack {
  name: string;
  artists: SpotifyArtist[];
}

export interface SpotifyArtist {
  name: string;
}

export interface SpotifySavedTracksResponse {
  href: string;
  limit: number;
  next: string | null;
  offset: number;
  previous: string | null;
  total: number;
  items: SpotifySavedTrack[];
}

export interface SpotifySavedTrack {
  added_at: string;
  track: SpotifyTrack;
}
