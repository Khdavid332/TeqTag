export class SpotifyApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseBody?: unknown,
    public readonly retryAfter?: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = new.target.name;
  }

  static failedRequest(error: unknown): SpotifyApiError {
    return new SpotifyApiError(
      'Failed to make request to Spotify API.',
      undefined,
      undefined,
      undefined,
      { cause: error }
    );
  }

  static async wrap(response: Response): Promise<SpotifyApiError> {
    let responseBody: unknown;

    try {
      responseBody = await response.json();
    } catch {
      /* Malformed json */
    }

    const retryAfterHeader = response.headers.get('Retry-After');
    const retryAfter = retryAfterHeader === null ? undefined : Number(retryAfterHeader);

    return new SpotifyApiError(
      `Spotify API request failed with status ${response.status}.`,
      response.status,
      responseBody,
      retryAfter !== undefined && Number.isNaN(retryAfter) ? undefined : retryAfter
    );
  }
}
