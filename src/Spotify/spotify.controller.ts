import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { Spotify, SpotifyAuthError, SpotifyTokens } from './spotify';

export const STATE_COOKIE_NAME = 'spotify_oauth_state';
export const STATE_COOKIE_TTL_MS = 10 * 60 * 1000;

export const STATE_COOKIE_OPTIONS = {
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

export class SpotifyController {
  constructor(
    private readonly spotify: Spotify,
    private readonly tokenStore: SpotifyTokenStore,
    private readonly resolveUserId: UserIdResolver,
    private readonly logger: Logger
  ) {}

  login = (_req: Request, res: Response): void => {
    const state = crypto.randomBytes(16).toString('hex');

    res.cookie(STATE_COOKIE_NAME, state, STATE_COOKIE_OPTIONS);

    res.redirect(this.spotify.authorization(state));
  };

  callback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { code, state, error } = req.query;
    const expectedState = req.cookies[STATE_COOKIE_NAME];

    if (typeof state !== 'string' || state !== expectedState) {
      this.logger.warn({ hasExpectedState: !!expectedState }, 'spotify oauth state mismatch');
      res.status(400).json({ error: 'invalid_state' });
      return;
    }

    res.clearCookie(STATE_COOKIE_NAME, STATE_COOKIE_OPTIONS);

    if (typeof error === 'string') {
      this.logger.warn({ error }, 'spotify authorization denied by user');
      res.status(400).json({ error: 'spotify_authorization_denied', detail: error });
      return;
    }

    if (typeof code !== 'string') {
      res.status(400).json({ error: 'missing_code' });
      return;
    }

    const userId = this.resolveUserId(req);

    try {
      const tokens = await this.spotify.exchangeCode(code);
      await this.tokenStore.save(userId, tokens);

      res.redirect('/settings/spotify?connected=1');
    } catch (err) {
      this.logAuthError(err, userId, 'spotify token exchange failed');
      next(err);
    }
  };

  refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = this.resolveUserId(req);

    try {
      const existing = await this.tokenStore.load(userId);

      if (!existing) {
        res.status(404).json({ error: 'not_connected' });
        return;
      }

      const tokens = await this.spotify.refreshAccess(existing.refreshToken);
      await this.tokenStore.save(userId, tokens);

      res.json({ expiresAt: tokens.expiresAt });
    } catch (err) {
      this.logAuthError(err, userId, 'spotify token refresh failed');
      next(err);
    }
  };

  private logAuthError = (err: unknown, userId: string, msg: string): void => {
    if (err instanceof SpotifyAuthError) {
      this.logger.error({ userId, errorType: err.type, msg: err.message }, msg);
    }
  };
}
