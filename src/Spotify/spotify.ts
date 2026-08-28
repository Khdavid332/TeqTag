const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface SpotifyTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface SpotifyOAuthErrorResponse {
  error: string;
  error_description?: string;
}

export class SpotifyAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpotifyAuthError';
  }

  static async wrap(response: Response): Promise<SpotifyAuthError> {
    const body = (await response.json().catch(() => null)) as SpotifyOAuthErrorResponse | null;

    const description = body?.error_description ?? body?.error ?? 'Unknown OAuth error';

    return new SpotifyAuthError(
      `Token exchange failed with status ${response.status}: ${description}`
    );
  }

  static missedRefreshToken(): SpotifyAuthError {
    return new SpotifyAuthError(
      'Spotify did not return a refresh_token on authorization_code grant'
    );
  }
}

export class Spotify {
  constructor(
    private clientId: string,
    private clientSecret: string,
    private redirectUrl: string,
    private scopes: string[]
  ) {}

  authorization(state: string) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      scope: this.scopes.join(' '),
      redirect_uri: this.redirectUrl,
      state,
    });

    return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
  }

  async claimAccess(code: string): Promise<SpotifyTokens> {
    const { access_token, refresh_token, expires_in } = await this.tokenRequest(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUrl,
      })
    );

    if (!refresh_token) {
      throw SpotifyAuthError.missedRefreshToken();
    }

    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Date.now() + expires_in * 1000,
    };
  }

  async refreshAccess(refreshToken: string): Promise<SpotifyTokens> {
    const { access_token, refresh_token, expires_in } = await this.tokenRequest(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })
    );

    return {
      accessToken: access_token,
      refreshToken: refresh_token ?? refreshToken,
      expiresAt: Date.now() + expires_in * 1000,
    };
  }

  private async tokenRequest(body: URLSearchParams): Promise<SpotifyTokenResponse> {
    const key = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${key}`,
      },
      body,
    });

    if (!response.ok) {
      throw await SpotifyAuthError.wrap(response);
    }

    return response.json();
  }
}
