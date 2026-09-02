import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Query,
  HttpStatus,
  UseFilters,
  Logger,
  Inject,
} from '@nestjs/common';
import { Request, Response } from 'express';
import crypto from 'crypto';
import { SpotifyService } from './services/spotify.service';
import { SpotifyTokenStore } from './interfaces/token-store.interface';
import { SpotifyExceptionFilter } from './exceptions/spotify-exception.filter';
import { SpotifyAuthError } from './exceptions/spotify-auth.error';
import {
  STATE_COOKIE_NAME,
  STATE_COOKIE_OPTIONS,
  SPOTIFY_TOKEN_STORE,
} from './constants/spotify.constants';
import { CurrentUser } from './decorators/current-user.decorator';

@Controller('spotify')
@UseFilters(SpotifyExceptionFilter)
export class SpotifyController {
  private readonly logger = new Logger(SpotifyController.name);

  constructor(
    private readonly spotifyService: SpotifyService,
    @Inject(SPOTIFY_TOKEN_STORE) private readonly tokenStore: SpotifyTokenStore
  ) {}

  @Get('login')
  login(@Res() res: Response): void {
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie(STATE_COOKIE_NAME, state, STATE_COOKIE_OPTIONS);
    res.redirect(this.spotifyService.authorization(state));
  }

  @Get('callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
    @CurrentUser() userId = 'user-123'
  ): Promise<void> {
    const expectedState = req.cookies?.[STATE_COOKIE_NAME];

    if (typeof state !== 'string' || state !== expectedState) {
      this.logger.warn({ hasExpectedState: !!expectedState }, 'spotify oauth state mismatch');
      res.status(HttpStatus.BAD_REQUEST).json({ error: 'invalid_state' });
      return;
    }

    res.clearCookie(STATE_COOKIE_NAME, STATE_COOKIE_OPTIONS);

    if (typeof error === 'string') {
      this.logger.warn({ error }, 'spotify authorization denied by user');
      res.status(HttpStatus.BAD_REQUEST).json({ error: 'spotify_authorization_denied', detail: error });
      return;
    }

    if (typeof code !== 'string') {
      res.status(HttpStatus.BAD_REQUEST).json({ error: 'missing_code' });
      return;
    }

    try {
      const tokens = await this.spotifyService.exchangeCode(code);
      await this.tokenStore.save(userId, tokens);
      res.redirect('/settings/spotify?connected=1');
    } catch (err) {
      this.logAuthError(err, userId, 'spotify token exchange failed');
      throw err;
    }
  }

  @Post('refresh')
  async refresh(
    @Res() res: Response,
    @CurrentUser() userId = 'user-123'
  ): Promise<void> {
    try {
      const existing = await this.tokenStore.load(userId);

      if (!existing) {
        res.status(HttpStatus.NOT_FOUND).json({ error: 'not_connected' });
        return;
      }

      const tokens = await this.spotifyService.refreshAccess(existing.refreshToken);
      await this.tokenStore.save(userId, tokens);

      res.status(HttpStatus.OK).json({ expiresAt: tokens.expiresAt });
    } catch (err) {
      this.logAuthError(err, userId, 'spotify token refresh failed');
      throw err;
    }
  }

  private logAuthError(err: unknown, userId: string, msg: string): void {
    if (err instanceof SpotifyAuthError) {
      this.logger.error({ userId, errorType: err.type, msg: err.message }, msg);
    }
  }
}
