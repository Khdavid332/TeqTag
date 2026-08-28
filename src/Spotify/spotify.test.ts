import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Spotify, SpotifyAuthError } from './spotify';

function fakeResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('Spotify', () => {
  let spotify: Spotify;

  beforeEach(() => {
    spotify = new Spotify('client-id', 'client-secret', 'https://app.example.com/callback', [
      'user-read-email',
      'user-read-private',
    ]);
  });

  afterEach(() => {
    mock.restoreAll();
  });

  describe('authorization', () => {
    test('builds a correct authorization URL', () => {
      const url = new URL(spotify.authorization('random-state'));

      assert.equal(url.origin + url.pathname, 'https://accounts.spotify.com/authorize');
      assert.equal(url.searchParams.get('response_type'), 'code');
      assert.equal(url.searchParams.get('client_id'), 'client-id');
      assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example.com/callback');
      assert.equal(url.searchParams.get('state'), 'random-state');
      assert.equal(url.searchParams.get('scope'), 'user-read-email user-read-private');
    });

    test('encodes authorization parameters', () => {
      const url = new URL(spotify.authorization('state with spaces & symbols'));

      assert.equal(url.searchParams.get('state'), 'state with spaces & symbols');
    });
  });

  describe('claimAccess', () => {
    test('exchanges code for tokens', async () => {
      const now = Date.now();
      mock.method(global, 'fetch', async () =>
        fakeResponse(200, {
          access_token: 'access-123',
          refresh_token: 'refresh-123',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'user-read-email',
        })
      );

      const tokens = await spotify.exchangeCode('auth-code');

      assert.equal(tokens.accessToken, 'access-123');
      assert.equal(tokens.refreshToken, 'refresh-123');
      assert.ok(tokens.expiresAt >= now + 3600 * 1000);
    });

    test('throws when Spotify does not return a refresh_token', async () => {
      mock.method(global, 'fetch', async () =>
        fakeResponse(200, {
          access_token: 'access-123',
          expires_in: 3600,
        })
      );

      await assert.rejects(
        () => spotify.exchangeCode('auth-code'),
        (err: unknown) => {
          assert.ok(err instanceof SpotifyAuthError);
          assert.match((err as Error).message, /did not return a refresh_token/);
          return true;
        }
      );
    });

    test('throws SpotifyAuthError with parsed error body on non-ok response', async () => {
      mock.method(global, 'fetch', async () =>
        fakeResponse(400, {
          error: 'invalid_grant',
          error_description: 'Authorization code expired',
        })
      );

      await assert.rejects(
        () => spotify.exchangeCode('bad-code'),
        (err: unknown) => {
          assert.ok(err instanceof SpotifyAuthError);
          assert.match((err as Error).message, /400/);
          assert.match((err as Error).message, /Authorization code expired/);
          return true;
        }
      );
    });

    test('throws SpotifyAuthError even when error body is not valid JSON', async () => {
      mock.method(
        global,
        'fetch',
        async () =>
          ({
            ok: false,
            status: 502,
            json: async () => {
              throw new Error('not json');
            },
          }) as unknown as Response
      );

      await assert.rejects(
        () => spotify.exchangeCode('any-code'),
        (err: unknown) => {
          assert.ok(err instanceof SpotifyAuthError);
          assert.match((err as Error).message, /502/);
          return true;
        }
      );
    });

    test('uses error_description when error is missing', async () => {
      mock.method(global, 'fetch', async () =>
        fakeResponse(400, {
          error_description: 'Authorization code expired',
        })
      );

      await assert.rejects(
        () => spotify.exchangeCode('bad-code'),
        (err: unknown) => {
          assert.ok(err instanceof SpotifyAuthError);
          assert.match(err.message, /Authorization code expired/);
          return true;
        }
      );
    });

    test('sends the correct token request', async () => {
      const fetchMock = mock.method(global, 'fetch', async () =>
        fakeResponse(200, {
          access_token: 'access-123',
          refresh_token: 'refresh-123',
          expires_in: 3600,
        })
      );

      await spotify.exchangeCode('auth-code');

      assert.equal(fetchMock.mock.calls.length, 1);

      const [url, init] = fetchMock.mock.calls[0].arguments;

      assert.equal(url, 'https://accounts.spotify.com/api/token');
      assert.equal(init?.method, 'POST');

      const headers = new Headers(init?.headers as HeadersInit);
      assert.equal(
        headers.get('Authorization'),
        `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`
      );

      const body = new URLSearchParams(init?.body?.toString() ?? '');
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(body.get('code'), 'auth-code');
      assert.equal(body.get('redirect_uri'), 'https://app.example.com/callback');
      assert.equal([...body.keys()].length, 3);
    });
  });

  describe('refreshAccess', () => {
    test('returns new tokens when refresh_token is rotated', async () => {
      mock.method(global, 'fetch', async () =>
        fakeResponse(200, {
          access_token: 'access-new',
          refresh_token: 'refresh-new',
          expires_in: 1800,
        })
      );

      const tokens = await spotify.refreshAccess('refresh-old');

      assert.equal(tokens.accessToken, 'access-new');
      assert.equal(tokens.refreshToken, 'refresh-new');
    });

    test('falls back to the original refresh_token when Spotify omits it', async () => {
      mock.method(global, 'fetch', async () =>
        fakeResponse(200, {
          access_token: 'access-new',
          expires_in: 1800,
        })
      );

      const tokens = await spotify.refreshAccess('refresh-old');

      assert.equal(tokens.refreshToken, 'refresh-old');
    });

    test('propagates SpotifyAuthError on failed refresh', async () => {
      mock.method(global, 'fetch', async () =>
        fakeResponse(401, { error: 'invalid_grant', error_description: 'Refresh token revoked' })
      );

      await assert.rejects(() => spotify.refreshAccess('revoked-token'), SpotifyAuthError);
    });
  });
});
