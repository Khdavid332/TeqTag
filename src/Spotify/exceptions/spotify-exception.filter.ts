import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { SpotifyAuthError, SpotifyAuthErrorType } from './spotify-auth.error';

@Catch(SpotifyAuthError)
export class SpotifyExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SpotifyExceptionFilter.name);

  catch(exception: SpotifyAuthError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    this.logger.error(
      { path: request.url, errorType: exception.type, msg: exception.message },
      'spotify auth error'
    );

    const status =
      exception.type === SpotifyAuthErrorType.FATAL
        ? HttpStatus.BAD_GATEWAY
        : HttpStatus.SERVICE_UNAVAILABLE;

    response.status(status).json({
      error: 'spotify_auth_failed',
      message: 'Spotify authorization failed. Please, try again later.',
    });
  }
}
