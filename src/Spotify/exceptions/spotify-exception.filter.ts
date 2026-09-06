import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { SpotifyAuthError, SpotifyAuthErrorType } from './spotify-auth.error';

interface ErrorResponseBody {
  status: HttpStatus;
  error: string;
  message: string;
}

const ERROR_RESPONSES: Record<SpotifyAuthErrorType, ErrorResponseBody> = {
  [SpotifyAuthErrorType.UNAUTHORIZED]: {
    status: HttpStatus.UNAUTHORIZED,
    error: 'spotify_reauthorization_required',
    message: 'Your Spotify connection has expired. Please reconnect your Spotify account.',
  },
  [SpotifyAuthErrorType.RETRYABLE]: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    error: 'spotify_auth_failed',
    message: 'Spotify authorization failed. Please try again later.',
  },
  [SpotifyAuthErrorType.FATAL]: {
    status: HttpStatus.BAD_GATEWAY,
    error: 'spotify_auth_failed',
    message: 'Spotify authorization failed. Please try again later.',
  },
};

@Catch(SpotifyAuthError)
export class SpotifyExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SpotifyExceptionFilter.name);

  catch(exception: SpotifyAuthError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    this.logger.error(
      { path: request.url, errorType: exception.type, message: exception.message },
      'spotify auth error'
    );

    const { status, error, message } = ERROR_RESPONSES[exception.type];

    response.status(status).json({ error, message });
  }
}
