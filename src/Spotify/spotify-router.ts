import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { Spotify, SpotifyAuthError, SpotifyAuthErrorType, SpotifyTokens } from './spotify';

const STATE_COOKIE_NAME = 'spotify_oauth_state';
const STATE_COOKIE_TTL_MS = 10 * 60 * 1000;

const STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  maxAge: STATE_COOKIE_TTL_MS,
};

export interface Logger {
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface SpotifyTokenStore {
  save(userId: string, tokens: SpotifyTokens): Promise<void>;
  load(userId: string): Promise<SpotifyTokens | null>;
}

export type UserIdResolver = (req: Request) => string;

export function createSpotifyRouter(
  spotify: Spotify,
  tokenStore: SpotifyTokenStore,
  resolveUserId: UserIdResolver,
  logger: Logger
): Router {
  const router = Router();

  router.get('/login', (_req: Request, res: Response) => {
    const state = crypto.randomBytes(16).toString('hex');

    res.cookie(STATE_COOKIE_NAME, state, STATE_COOKIE_OPTIONS);

    res.redirect(spotify.authorization(state));
  });

  router.get('/callback', async (req: Request, res: Response, next: NextFunction) => {
    const { code, state, error } = req.query;

    const expectedState = req.cookies?.[STATE_COOKIE_NAME];

    if (!expectedState || state !== expectedState) {
      logger.warn({ hasExpectedState: !!expectedState }, 'spotify oauth state mismatch');

      return res.status(400).json({ error: 'invalid_state' });
    }

    res.clearCookie(STATE_COOKIE_NAME, STATE_COOKIE_OPTIONS);

    if (typeof error === 'string') {
      logger.warn({ error }, 'spotify authorization denied by user');

      return res.status(400).json({
        error: 'spotify_authorization_denied',
        detail: error,
      });
    }

    if (typeof code !== 'string') {
      return res.status(400).json({ error: 'missing_code' });
    }

    const userId = resolveUserId(req);

    try {
      const tokens = await spotify.exchangeCode(code);
      await tokenStore.save(userId, tokens);

      res.redirect('/settings/spotify?connected=1');
    } catch (err) {
      if (err instanceof SpotifyAuthError) {
        logger.error(
          {
            userId,
            errorType: err.type,
            cause: err.cause,
            msg: err.message,
          },
          'spotify token exchange failed'
        );
      }

      next(err);
    }
  });

  router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
    const userId = resolveUserId(req);

    try {
      const existing = await tokenStore.load(userId);

      if (!existing) {
        return res.status(404).json({ error: 'not_connected' });
      }

      const tokens = await spotify.refreshAccess(existing.refreshToken);
      await tokenStore.save(userId, tokens);

      res.json({ expiresAt: tokens.expiresAt });
    } catch (err) {
      if (err instanceof SpotifyAuthError) {
        logger.error(
          {
            userId,
            errorType: err.type,
            cause: err.cause,
            msg: err.message,
          },
          'spotify token refresh failed'
        );
      }

      next(err);
    }
  });

  router.use(spotifyErrorHandler);

  return router;
}

function spotifyErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (!(err instanceof SpotifyAuthError)) {
    return next(err);
  }

  const status = err.type === SpotifyAuthErrorType.RETRYABLE ? 503 : 502;

  res.status(status).json({
    error: 'spotify_auth_failed',
    retryable: err.type === SpotifyAuthErrorType.RETRYABLE,
    message: err.message,
  });
}
