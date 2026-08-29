import { Router, Request, Response, NextFunction } from 'express';
import { Spotify, SpotifyAuthError, SpotifyAuthErrorType } from './spotify';
import { SpotifyController, Logger, SpotifyTokenStore, UserIdResolver } from './spotify.controller';

export type { Logger, SpotifyTokenStore, UserIdResolver };

const spotifyErrorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!(err instanceof SpotifyAuthError)) {
    next(err);
    return;
  }

  const status = err.type === SpotifyAuthErrorType.FATAL ? 502 : 503;

  res.status(status).json({
    error: 'spotify_auth_failed',
    message: 'Spotify authorization failed. Please, try again later.',
  });
};

export function createSpotifyRouter(
  spotify: Spotify,
  tokenStore: SpotifyTokenStore,
  resolveUserId: UserIdResolver,
  logger: Logger
): Router {
  const router = Router();
  const controller = new SpotifyController(spotify, tokenStore, resolveUserId, logger);

  router.get('/login', controller.login);
  router.get('/callback', controller.callback);
  router.post('/refresh', controller.refresh);
  router.use(spotifyErrorHandler);

  return router;
}
