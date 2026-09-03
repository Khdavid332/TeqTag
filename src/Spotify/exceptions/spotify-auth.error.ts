export enum SpotifyAuthErrorType {
  FATAL = 'fatal',
  RETRYABLE = 'retryable',
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
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      error_description?: string;
    } | null;
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
