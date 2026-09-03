import { registerAs } from '@nestjs/config';

export const SPOTIFY_CONFIG = 'spotify';

export default registerAs(SPOTIFY_CONFIG, () => ({
  timeout: 5000,
  clientId: process.env.SPOTIFY_CLIENT_ID || '',
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
  redirectUrl: process.env.SPOTIFY_REDIRECT_URI || '',
  scopes: ['user-read-email', 'user-read-private'],
}));
