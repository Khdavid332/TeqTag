import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SpotifyService } from '../services/spotify.service';
import { SpotifyAuthError, SpotifyAuthErrorType } from '../exceptions/spotify-auth.error';

function fakeResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('SpotifyService', () => {
  let service: SpotifyService;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpotifyService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'SPOTIFY_CLIENT_ID') return 'client-id';
              if (key === 'SPOTIFY_CLIENT_SECRET') return 'client-secret';
              if (key === 'SPOTIFY_REDIRECT_URI') return 'https://app.example.com/callback';
              return undefined;
            },
          },
        },
      ],
    }).compile();

    service = module.get<SpotifyService>(SpotifyService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('authorization', () => {
    it('builds a correct authorization URL', () => {
      const url = new URL(service.authorization('random-state'));

      expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe('client-id');
      expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/callback');
      expect(url.searchParams.get('state')).toBe('random-state');
      expect(url.searchParams.get('scope')).toBe('user-read-email user-read-private');
    });

    it('encodes authorization parameters', () => {
      const url = new URL(service.authorization('state with spaces & symbols'));
      expect(url.searchParams.get('state')).toBe('state with spaces & symbols');
    });
  });

  describe('exchangeCode', () => {
    it('exchanges code for tokens', async () => {
      const now = Date.now();
      global.fetch = jest.fn().mockResolvedValue(
        fakeResponse(200, {
          access_token: 'access-123',
          refresh_token: 'refresh-123',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'user-read-email',
        })
      );

      const tokens = await service.exchangeCode('auth-code');

      expect(tokens.accessToken).toBe('access-123');
      expect(tokens.refreshToken).toBe('refresh-123');
      expect(tokens.expiresAt.getTime()).toBeGreaterThanOrEqual(now + 3600 * 1000 - 50);
    });

    it('throws when Spotify does not return a refresh_token', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        fakeResponse(200, {
          access_token: 'access-123',
          expires_in: 3600,
        })
      );

      await expect(service.exchangeCode('auth-code')).rejects.toThrow(SpotifyAuthError);
    });

    it('throws SpotifyAuthError with parsed error body on non-ok response', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        fakeResponse(400, {
          error: 'invalid_grant',
          error_description: 'Authorization code expired',
        })
      );

      await expect(service.exchangeCode('bad-code')).rejects.toMatchObject({
        message: expect.stringContaining('Authorization code expired'),
        type: SpotifyAuthErrorType.FATAL,
      });
    });

    it('throws SpotifyAuthError even when error body is not valid JSON', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('not json');
        },
      } as unknown as Response);

      await expect(service.exchangeCode('any-code')).rejects.toMatchObject({
        message: expect.stringContaining('502'),
        type: SpotifyAuthErrorType.RETRYABLE,
      });
    });

    it('sends the correct token request headers and body', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        fakeResponse(200, {
          access_token: 'access-123',
          refresh_token: 'refresh-123',
          expires_in: 3600,
        })
      );
      global.fetch = fetchMock;

      await service.exchangeCode('auth-code');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];

      expect(url).toBe('https://accounts.spotify.com/api/token');
      expect(init?.method).toBe('POST');

      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe(
        `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`
      );

      const body = new URLSearchParams(init?.body?.toString());
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('auth-code');
      expect(body.get('redirect_uri')).toBe('https://app.example.com/callback');
    });
  });

  describe('refreshAccess', () => {
    it('returns new tokens when refresh_token is rotated', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        fakeResponse(200, {
          access_token: 'access-new',
          refresh_token: 'refresh-new',
          expires_in: 1800,
        })
      );

      const tokens = await service.refreshAccess('refresh-old');

      expect(tokens.accessToken).toBe('access-new');
      expect(tokens.refreshToken).toBe('refresh-new');
    });

    it('falls back to original refresh_token when Spotify omits it', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        fakeResponse(200, {
          access_token: 'access-new',
          expires_in: 1800,
        })
      );

      const tokens = await service.refreshAccess('refresh-old');

      expect(tokens.refreshToken).toBe('refresh-old');
    });

    it('propagates SpotifyAuthError on failed refresh', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        fakeResponse(401, { error: 'invalid_grant', error_description: 'Refresh token revoked' })
      );

      await expect(service.refreshAccess('revoked-token')).rejects.toThrow(SpotifyAuthError);
    });
  });

  describe('error classification', () => {
    it('marks 429 as retryable', async () => {
      global.fetch = jest.fn().mockResolvedValue(fakeResponse(429, { error: 'rate_limited' }));

      await expect(service.exchangeCode('auth-code')).rejects.toMatchObject({
        type: SpotifyAuthErrorType.RETRYABLE,
      });
    });

    it('marks 5xx as retryable', async () => {
      global.fetch = jest.fn().mockResolvedValue(fakeResponse(503, { error: 'server_error' }));

      await expect(service.exchangeCode('auth-code')).rejects.toMatchObject({
        type: SpotifyAuthErrorType.RETRYABLE,
      });
    });

    it('marks invalid_grant as fatal', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        fakeResponse(400, { error: 'invalid_grant', error_description: 'Authorization code expired' })
      );

      await expect(service.exchangeCode('bad-code')).rejects.toMatchObject({
        type: SpotifyAuthErrorType.FATAL,
      });
    });

    it('marks temporarily_unavailable as retryable even on 400', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        fakeResponse(400, { error: 'temporarily_unavailable' })
      );

      await expect(service.exchangeCode('auth-code')).rejects.toMatchObject({
        type: SpotifyAuthErrorType.RETRYABLE,
      });
    });

    it('wraps network failure as retryable', async () => {
      global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));

      await expect(service.exchangeCode('auth-code')).rejects.toMatchObject({
        type: SpotifyAuthErrorType.RETRYABLE,
      });
    });

    it('wraps timeout as retryable with correct message', async () => {
      global.fetch = jest.fn().mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'));

      await expect(service.exchangeCode('auth-code')).rejects.toMatchObject({
        message: expect.stringContaining('timed out'),
        type: SpotifyAuthErrorType.RETRYABLE,
      });
    });
  });
});
