import { Test, TestingModule } from '@nestjs/testing';
import { SpotifyClient } from '../services/spotify.client';
import { SpotifyApiError } from '../exceptions/spotify.error';
import spotifyConfig from '../spotify.config';

function fakeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
  ok = status >= 200 && status < 300
): Response {
  return {
    ok,
    status,
    json: async () => body,
    headers: {
      get: (name: string) => headers[name] ?? null,
    },
  } as unknown as Response;
}

describe('SpotifyClient', () => {
  let client: SpotifyClient;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpotifyClient,
        {
          provide: spotifyConfig.KEY,
          useValue: {
            timeout: 5000,
          },
        },
      ],
    }).compile();

    client = module.get<SpotifyClient>(SpotifyClient);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('getSavedTracks', () => {
    it('returns parsed data on success', async () => {
      const mockBody = { items: [], total: 0 };

      global.fetch = jest.fn().mockResolvedValue(fakeResponse(200, mockBody));

      const result = await client.getSavedTracks('access-token');

      expect(result).toEqual(mockBody);
    });

    it('sends correct URL, query params and headers', async () => {
      const fetchMock = jest.fn().mockResolvedValue(fakeResponse(200, { items: [] }));
      global.fetch = fetchMock;

      await client.getSavedTracks('my-token', 10, 5);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];

      expect(url).toBe('https://api.spotify.com/v1/me/tracks?limit=10&offset=5');
      expect(init?.headers).toMatchObject({
        Accept: 'application/json',
        Authorization: 'Bearer my-token',
      });
    });

    it('uses default limit and offset when not provided', async () => {
      const fetchMock = jest.fn().mockResolvedValue(fakeResponse(200, { items: [] }));
      global.fetch = fetchMock;

      await client.getSavedTracks('my-token');

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.spotify.com/v1/me/tracks?limit=50&offset=0');
    });

    it('throws SpotifyApiError.failedRequest on network failure', async () => {
      global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));

      await expect(client.getSavedTracks('token')).rejects.toBeInstanceOf(SpotifyApiError);
    });

    it('throws SpotifyApiError with status and body on non-ok response', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(fakeResponse(401, { error: { message: 'Invalid token' } }));

      await expect(client.getSavedTracks('bad-token')).rejects.toMatchObject({
        status: 401,
        responseBody: { error: { message: 'Invalid token' } },
      });
    });

    it('parses Retry-After header on 429', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(fakeResponse(429, { error: 'rate_limited' }, { 'Retry-After': '30' }));

      await expect(client.getSavedTracks('token')).rejects.toMatchObject({
        status: 429,
        retryAfter: 30,
      });
    });

    it('leaves retryAfter undefined when Retry-After header is absent', async () => {
      global.fetch = jest.fn().mockResolvedValue(fakeResponse(500, {}));

      await expect(client.getSavedTracks('token')).rejects.toMatchObject({
        retryAfter: undefined,
      });
    });

    it('throws SpotifyApiError when response body is malformed JSON', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('not json');
        },
        headers: { get: () => null },
      } as unknown as Response);

      await expect(client.getSavedTracks('token')).rejects.toBeInstanceOf(SpotifyApiError);
    });

    it('respects the configured timeout via AbortSignal', async () => {
      const fetchMock = jest.fn().mockResolvedValue(fakeResponse(200, { items: [] }));
      global.fetch = fetchMock;

      await client.getSavedTracks('token');

      const [, init] = fetchMock.mock.calls[0];
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
