import express, { type Request, type Response, type NextFunction } from 'express';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

import { createSpotifyRouter, type Logger, type SpotifyTokenStore } from '../spotify.router';
import { Spotify, SpotifyAuthError, SpotifyAuthErrorType, type SpotifyTokens } from '../spotify';

function extractCookiePair(setCookieHeader: string): string {
  return setCookieHeader.split(';')[0];
}

function parseCookies(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.cookie;
  req.cookies = {};

  if (header) {
    for (const pair of header.split(';')) {
      const [name, ...rest] = pair.trim().split('=');
      req.cookies[name] = decodeURIComponent(rest.join('='));
    }
  }

  next();
}

const SOME_TOKENS: SpotifyTokens = {
  accessToken: 'access-123',
  refreshToken: 'refresh-123',
  expiresAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('Spotify router', () => {
  let server: Server;
  let baseUrl: string;

  let spotify: {
    authorization: ReturnType<typeof mock.fn>;
    exchangeCode: ReturnType<typeof mock.fn>;
    refreshAccess: ReturnType<typeof mock.fn>;
  };

  let tokenStore: {
    save: ReturnType<typeof mock.fn>;
    load: ReturnType<typeof mock.fn>;
  };

  let logger: {
    warn: ReturnType<typeof mock.fn>;
    error: ReturnType<typeof mock.fn>;
  };

  beforeEach(async () => {
    spotify = {
      authorization: mock.fn(() => 'https://accounts.spotify.com/authorize?state=test'),
      exchangeCode: mock.fn(async () => SOME_TOKENS),
      refreshAccess: mock.fn(async () => SOME_TOKENS),
    };

    tokenStore = {
      save: mock.fn(async () => {}),
      load: mock.fn(async () => null),
    };

    logger = {
      warn: mock.fn(),
      error: mock.fn(),
    };

    const app = express();

    app.use(parseCookies);

    app.use(
      '/spotify',
      createSpotifyRouter(
        spotify as unknown as Spotify,
        tokenStore as unknown as SpotifyTokenStore,
        () => 'user-123',
        logger as unknown as Logger
      )
    );

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();

    assert.ok(address && typeof address === 'object');

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  async function login(): Promise<string> {
    const response = await fetch(`${baseUrl}/spotify/login`, {
      redirect: 'manual',
    });

    const setCookie = response.headers.get('set-cookie');
    assert.ok(setCookie, 'expected /login to set the state cookie');

    return extractCookiePair(setCookie);
  }

  describe('GET /login', () => {
    test('redirects to Spotify authorization and sets the state cookie', async () => {
      const response = await fetch(`${baseUrl}/spotify/login`, {
        redirect: 'manual',
      });

      assert.equal(response.status, 302);
      assert.equal(
        response.headers.get('location'),
        'https://accounts.spotify.com/authorize?state=test'
      );

      const setCookie = response.headers.get('set-cookie');

      assert.ok(setCookie);
      assert.match(setCookie, /spotify_oauth_state=/);
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /Secure/i);
      assert.match(setCookie, /SameSite=Lax/i);

      assert.equal(spotify.authorization.mock.calls.length, 1);

      const [state] = spotify.authorization.mock.calls[0].arguments;

      assert.ok(typeof state === 'string');
      assert.equal(state.length, 32);
    });
  });

  describe('GET /callback', () => {
    test('rejects when no state cookie was ever set', async () => {
      const response = await fetch(`${baseUrl}/spotify/callback?state=whatever&code=abc`);

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'invalid_state' });
      assert.equal(logger.warn.mock.calls.length, 1);
      assert.equal(spotify.exchangeCode.mock.calls.length, 0);
    });

    test('rejects when returned state does not match the cookie', async () => {
      const cookiePair = await login();

      const response = await fetch(`${baseUrl}/spotify/callback?state=tampered&code=abc`, {
        headers: { Cookie: cookiePair },
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'invalid_state' });
      assert.equal(logger.warn.mock.calls.length, 1);
      assert.equal(spotify.exchangeCode.mock.calls.length, 0);
    });

    test('surfaces Spotify authorization denial once state is valid', async () => {
      const cookiePair = await login();
      const state = cookiePair.split('=')[1];

      const response = await fetch(
        `${baseUrl}/spotify/callback?state=${state}&error=access_denied`,
        { headers: { Cookie: cookiePair } }
      );

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: 'spotify_authorization_denied',
        detail: 'access_denied',
      });
      assert.equal(logger.warn.mock.calls.length, 1);
      assert.equal(spotify.exchangeCode.mock.calls.length, 0);
    });

    test('rejects when code is missing', async () => {
      const cookiePair = await login();
      const state = cookiePair.split('=')[1];

      const response = await fetch(`${baseUrl}/spotify/callback?state=${state}`, {
        headers: { Cookie: cookiePair },
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'missing_code' });
      assert.equal(spotify.exchangeCode.mock.calls.length, 0);
    });

    test('exchanges the code, persists tokens, and redirects on success', async () => {
      const cookiePair = await login();
      const state = cookiePair.split('=')[1];

      const response = await fetch(`${baseUrl}/spotify/callback?state=${state}&code=auth-code`, {
        headers: { Cookie: cookiePair },
        redirect: 'manual',
      });

      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), '/settings/spotify?connected=1');

      assert.equal(spotify.exchangeCode.mock.calls.length, 1);
      assert.deepEqual(spotify.exchangeCode.mock.calls[0].arguments, ['auth-code']);

      assert.equal(tokenStore.save.mock.calls.length, 1);
      assert.deepEqual(tokenStore.save.mock.calls[0].arguments, ['user-123', SOME_TOKENS]);
    });

    test('maps a retryable SpotifyAuthError to 503', async () => {
      spotify.exchangeCode.mock.mockImplementationOnce(async () => {
        throw new SpotifyAuthError('Spotify is down', SpotifyAuthErrorType.RETRYABLE);
      });

      const cookiePair = await login();
      const state = cookiePair.split('=')[1];

      const response = await fetch(`${baseUrl}/spotify/callback?state=${state}&code=auth-code`, {
        headers: { Cookie: cookiePair },
      });

      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: 'spotify_auth_failed',
        message: 'Spotify authorization failed. Please, try again later.',
      });
      assert.equal(logger.error.mock.calls.length, 1);

      const [loggedContext] = logger.error.mock.calls[0].arguments;
      assert.equal(
        (loggedContext as { errorType: SpotifyAuthErrorType }).errorType,
        SpotifyAuthErrorType.RETRYABLE
      );
    });

    test('maps a fatal SpotifyAuthError to 502', async () => {
      spotify.exchangeCode.mock.mockImplementationOnce(async () => {
        throw new SpotifyAuthError('Invalid grant', SpotifyAuthErrorType.FATAL);
      });

      const cookiePair = await login();
      const state = cookiePair.split('=')[1];

      const response = await fetch(`${baseUrl}/spotify/callback?state=${state}&code=auth-code`, {
        headers: { Cookie: cookiePair },
      });

      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), {
        error: 'spotify_auth_failed',
        message: 'Spotify authorization failed. Please, try again later.',
      });
    });

    test('lets a non-SpotifyAuthError fall through to the default handler', async () => {
      spotify.exchangeCode.mock.mockImplementationOnce(async () => {
        throw new Error('boom');
      });

      const cookiePair = await login();
      const state = cookiePair.split('=')[1];

      const response = await fetch(`${baseUrl}/spotify/callback?state=${state}&code=auth-code`, {
        headers: { Cookie: cookiePair },
      });

      assert.equal(response.status, 500);
      assert.equal(logger.error.mock.calls.length, 0);
    });
  });

  describe('POST /refresh', () => {
    test('returns 404 when the user has no stored tokens', async () => {
      const response = await fetch(`${baseUrl}/spotify/refresh`, {
        method: 'POST',
      });

      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'not_connected' });
      assert.equal(spotify.refreshAccess.mock.calls.length, 0);
    });

    test('refreshes and persists new tokens on success', async () => {
      tokenStore.load.mock.mockImplementationOnce(async () => SOME_TOKENS);

      const response = await fetch(`${baseUrl}/spotify/refresh`, {
        method: 'POST',
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        expiresAt: SOME_TOKENS.expiresAt.toISOString(),
      });

      assert.equal(spotify.refreshAccess.mock.calls.length, 1);
      assert.deepEqual(spotify.refreshAccess.mock.calls[0].arguments, [SOME_TOKENS.refreshToken]);

      assert.equal(tokenStore.save.mock.calls.length, 1);
      assert.deepEqual(tokenStore.save.mock.calls[0].arguments, ['user-123', SOME_TOKENS]);
    });

    test('maps a retryable SpotifyAuthError to 503', async () => {
      tokenStore.load.mock.mockImplementationOnce(async () => SOME_TOKENS);
      spotify.refreshAccess.mock.mockImplementationOnce(async () => {
        throw new SpotifyAuthError('Spotify is down', SpotifyAuthErrorType.RETRYABLE);
      });

      const response = await fetch(`${baseUrl}/spotify/refresh`, {
        method: 'POST',
      });

      assert.equal(response.status, 503);
      assert.equal(logger.error.mock.calls.length, 1);
    });

    test('maps a fatal SpotifyAuthError to 502', async () => {
      tokenStore.load.mock.mockImplementationOnce(async () => SOME_TOKENS);
      spotify.refreshAccess.mock.mockImplementationOnce(async () => {
        throw new SpotifyAuthError('Refresh token revoked', SpotifyAuthErrorType.FATAL);
      });

      const response = await fetch(`${baseUrl}/spotify/refresh`, {
        method: 'POST',
      });

      assert.equal(response.status, 502);
    });
  });
});
