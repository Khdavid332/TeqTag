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

export interface SpotifyOAuthErrorResponse {
  error: string;
  error_description?: string;
}
