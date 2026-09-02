export const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

export const STATE_COOKIE_NAME = 'spotify_oauth_state';
export const STATE_COOKIE_TTL_MS = 10 * 60 * 1000;

export const STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  maxAge: STATE_COOKIE_TTL_MS,
};

export const SPOTIFY_TOKEN_STORE = 'SPOTIFY_TOKEN_STORE';
