const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export enum SpotifyAuthErrorType {
  FATAL = 'fatal',
  RETRYABLE = 'retryable',
}

interface SpotifyTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface SpotifyOAuthErrorResponse {
  error: string;
  error_description?: string;
}

export class SpotifyAuthError extends Error {
  constructor(
    message: string,
    public readonly type: SpotifyAuthErrorType,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'SpotifyAuthError';
  }

  static async wrap(response: Response): Promise<SpotifyAuthError> {
    const body = (await response.json().catch(() => null)) as SpotifyOAuthErrorResponse | null;
    const description = body?.error_description ?? body?.error ?? 'Unknown OAuth error';
    const type = SpotifyAuthError.classifyStatus(response.status, body?.error);

    return new SpotifyAuthError(
      `Token exchange failed with status ${response.status}: ${description}`,
      type
    );
  }

  static missedRefreshToken(): SpotifyAuthError {
    return new SpotifyAuthError(
      'Spotify did not return a refresh_token on authorization_code grant',
      SpotifyAuthErrorType.FATAL
    );
  }

  static failedRequest(cause: unknown): SpotifyAuthError {
    const isTimeout = cause instanceof DOMException && cause.name === 'TimeoutError';
    const message = isTimeout ? 'Token request timed out' : 'Token request failed';

    return new SpotifyAuthError(message, SpotifyAuthErrorType.RETRYABLE, { cause });
  }

  private static classifyStatus(status: number, errorCode?: string): SpotifyAuthErrorType {
    const retryableCodes = new Set(['server_error', 'temporarily_unavailable']);

    if (errorCode && retryableCodes.has(errorCode)) {
      return SpotifyAuthErrorType.RETRYABLE;
    }

    if (status === 429 || status >= 500) {
      return SpotifyAuthErrorType.RETRYABLE;
    }

    return SpotifyAuthErrorType.FATAL;
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

  async exchangeCode(code: string): Promise<SpotifyTokens> {
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
      expiresAt: new Date(Date.now() + expires_in * 1000),
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
      expiresAt: new Date(Date.now() + expires_in * 1000),
    };
  }

  private async tokenRequest(body: URLSearchParams): Promise<SpotifyTokenResponse> {
    const basicAuthHeader = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    let response: Response;

    try {
      response = await fetch(SPOTIFY_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          Authorization: `Basic ${basicAuthHeader}`,
        },
        body,
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      throw SpotifyAuthError.failedRequest(error);
    }

    if (!response.ok) {
      throw await SpotifyAuthError.wrap(response);
    }

    return response.json();
  }
}
