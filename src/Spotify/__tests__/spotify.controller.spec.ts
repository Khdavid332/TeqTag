import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module';
import { SpotifyService } from '../services/spotify.service';
import { TokenStoreService } from '../services/token-store.service';
import { SpotifyAuthError, SpotifyAuthErrorType } from '../exceptions/spotify-auth.error';
import { SpotifyTokens } from '../interfaces/spotify.interface';

const SOME_TOKENS: SpotifyTokens = {
  accessToken: 'access-123',
  refreshToken: 'refresh-123',
  expiresAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('Spotify Controller & App (e2e/integration)', () => {
  let app: INestApplication;
  let spotifyService: {
    authorization: jest.Mock;
    exchangeCode: jest.Mock;
    refreshAccess: jest.Mock;
  };
  let tokenStoreService: {
    save: jest.Mock;
    load: jest.Mock;
  };

  beforeEach(async () => {
    spotifyService = {
      authorization: jest.fn(() => 'https://accounts.spotify.com/authorize?state=test'),
      exchangeCode: jest.fn(async () => SOME_TOKENS),
      refreshAccess: jest.fn(async () => SOME_TOKENS),
    };

    tokenStoreService = {
      save: jest.fn(async () => {}),
      load: jest.fn(async () => null),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SpotifyService)
      .useValue(spotifyService)
      .overrideProvider(TokenStoreService)
      .useValue(tokenStoreService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /', () => {
    it('returns Test', async () => {
      const res = await request(app.getHttpServer()).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toBe('Test');
    });
  });

  describe('GET /spotify/login', () => {
    it('redirects to Spotify authorization and sets the state cookie', async () => {
      const res = await request(app.getHttpServer()).get('/spotify/login');

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('https://accounts.spotify.com/authorize?state=test');

      const setCookie = res.header['set-cookie'];
      expect(setCookie).toBeDefined();
      expect(setCookie[0]).toMatch(/spotify_oauth_state=/);
      expect(setCookie[0]).toMatch(/HttpOnly/i);
      expect(setCookie[0]).toMatch(/Secure/i);
      expect(setCookie[0]).toMatch(/SameSite=Lax/i);

      expect(spotifyService.authorization).toHaveBeenCalledTimes(1);
      const stateArg = spotifyService.authorization.mock.calls[0][0];
      expect(typeof stateArg).toBe('string');
      expect(stateArg.length).toBe(32);
    });
  });

  describe('GET /spotify/callback', () => {
    it('rejects when no state cookie was ever set', async () => {
      const res = await request(app.getHttpServer()).get(
        '/spotify/callback?state=whatever&code=abc'
      );

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invalid_state' });
      expect(spotifyService.exchangeCode).not.toHaveBeenCalled();
    });

    it('rejects when returned state does not match the cookie', async () => {
      const loginRes = await request(app.getHttpServer()).get('/spotify/login');
      const cookieHeader = loginRes.header['set-cookie'];

      const res = await request(app.getHttpServer())
        .get('/spotify/callback?state=tampered&code=abc')
        .set('Cookie', cookieHeader);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invalid_state' });
      expect(spotifyService.exchangeCode).not.toHaveBeenCalled();
    });

    it('surfaces Spotify authorization denial once state is valid', async () => {
      const loginRes = await request(app.getHttpServer()).get('/spotify/login');
      const cookieHeader = loginRes.header['set-cookie'];
      const state = cookieHeader[0].split(';')[0].split('=')[1];

      const res = await request(app.getHttpServer())
        .get(`/spotify/callback?state=${state}&error=access_denied`)
        .set('Cookie', cookieHeader);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'spotify_authorization_denied',
        detail: 'access_denied',
      });
      expect(spotifyService.exchangeCode).not.toHaveBeenCalled();
    });

    it('rejects when code is missing', async () => {
      const loginRes = await request(app.getHttpServer()).get('/spotify/login');
      const cookieHeader = loginRes.header['set-cookie'];
      const state = cookieHeader[0].split(';')[0].split('=')[1];

      const res = await request(app.getHttpServer())
        .get(`/spotify/callback?state=${state}`)
        .set('Cookie', cookieHeader);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'missing_code' });
      expect(spotifyService.exchangeCode).not.toHaveBeenCalled();
    });

    it('exchanges the code, persists tokens, and redirects on success', async () => {
      const loginRes = await request(app.getHttpServer()).get('/spotify/login');
      const cookieHeader = loginRes.header['set-cookie'];
      const state = cookieHeader[0].split(';')[0].split('=')[1];

      const res = await request(app.getHttpServer())
        .get(`/spotify/callback?state=${state}&code=auth-code`)
        .set('Cookie', cookieHeader);

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/settings/spotify?connected=1');
      expect(spotifyService.exchangeCode).toHaveBeenCalledWith('auth-code');
      expect(tokenStoreService.save).toHaveBeenCalledWith('user-123', SOME_TOKENS);
    });

    it('maps a retryable SpotifyAuthError to 503', async () => {
      spotifyService.exchangeCode.mockRejectedValueOnce(
        new SpotifyAuthError('Spotify is down', SpotifyAuthErrorType.RETRYABLE)
      );

      const loginRes = await request(app.getHttpServer()).get('/spotify/login');
      const cookieHeader = loginRes.header['set-cookie'];
      const state = cookieHeader[0].split(';')[0].split('=')[1];

      const res = await request(app.getHttpServer())
        .get(`/spotify/callback?state=${state}&code=auth-code`)
        .set('Cookie', cookieHeader);

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        error: 'spotify_auth_failed',
        message: 'Spotify authorization failed. Please, try again later.',
      });
    });

    it('maps a fatal SpotifyAuthError to 502', async () => {
      spotifyService.exchangeCode.mockRejectedValueOnce(
        new SpotifyAuthError('Invalid grant', SpotifyAuthErrorType.FATAL)
      );

      const loginRes = await request(app.getHttpServer()).get('/spotify/login');
      const cookieHeader = loginRes.header['set-cookie'];
      const state = cookieHeader[0].split(';')[0].split('=')[1];

      const res = await request(app.getHttpServer())
        .get(`/spotify/callback?state=${state}&code=auth-code`)
        .set('Cookie', cookieHeader);

      expect(res.status).toBe(502);
      expect(res.body).toEqual({
        error: 'spotify_auth_failed',
        message: 'Spotify authorization failed. Please, try again later.',
      });
    });
  });

  describe('POST /spotify/refresh', () => {
    it('returns 404 when the user has no stored tokens', async () => {
      const res = await request(app.getHttpServer()).post('/spotify/refresh');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'not_connected' });
      expect(spotifyService.refreshAccess).not.toHaveBeenCalled();
    });

    it('refreshes and persists new tokens on success', async () => {
      tokenStoreService.load.mockResolvedValueOnce(SOME_TOKENS);

      const res = await request(app.getHttpServer()).post('/spotify/refresh');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        expiresAt: SOME_TOKENS.expiresAt.toISOString(),
      });
      expect(spotifyService.refreshAccess).toHaveBeenCalledWith(SOME_TOKENS.refreshToken);
      expect(tokenStoreService.save).toHaveBeenCalledWith('user-123', SOME_TOKENS);
    });

    it('maps a retryable SpotifyAuthError to 503', async () => {
      tokenStoreService.load.mockResolvedValueOnce(SOME_TOKENS);
      spotifyService.refreshAccess.mockRejectedValueOnce(
        new SpotifyAuthError('Spotify is down', SpotifyAuthErrorType.RETRYABLE)
      );

      const res = await request(app.getHttpServer()).post('/spotify/refresh');

      expect(res.status).toBe(503);
    });

    it('maps a fatal SpotifyAuthError to 502', async () => {
      tokenStoreService.load.mockResolvedValueOnce(SOME_TOKENS);
      spotifyService.refreshAccess.mockRejectedValueOnce(
        new SpotifyAuthError('Refresh token revoked', SpotifyAuthErrorType.FATAL)
      );

      const res = await request(app.getHttpServer()).post('/spotify/refresh');

      expect(res.status).toBe(502);
    });
  });
});
