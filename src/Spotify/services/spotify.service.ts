import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SPOTIFY_AUTH_URL, SPOTIFY_TOKEN_URL } from '../constants/spotify.constants';
import { SpotifyTokens, SpotifyTokenResponse } from '../interfaces/spotify.interface';
import { SpotifyAuthError } from '../exceptions/spotify-auth.error';

@Injectable()
export class SpotifyService {
  private clientId: string;
  private clientSecret: string;
  private redirectUrl: string;
  private scopes: string[];

  constructor(private readonly configService: ConfigService) {
    this.clientId = this.configService.get<string>('SPOTIFY_CLIENT_ID') || '';
    this.clientSecret = this.configService.get<string>('SPOTIFY_CLIENT_SECRET') || '';
    this.redirectUrl = this.configService.get<string>('SPOTIFY_REDIRECT_URI') || '';
    this.scopes = ['user-read-email', 'user-read-private'];
  }

  setOptions(options: { clientId: string; clientSecret: string; redirectUrl: string; scopes?: string[] }) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.redirectUrl = options.redirectUrl;
    if (options.scopes) {
      this.scopes = options.scopes;
    }
  }

  authorization(state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      scope: this.scopes.join(' '),
      redirect_uri: this.redirectUrl,
      state,
    });

    return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<SpotifyTokens> {
    const { access_token, refresh_token, expires_in } = await this.tokenRequest(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUrl,
      })
    );

    if (!refresh_token) {
      throw SpotifyAuthError.missedRefreshToken();
    }

    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: new Date(Date.now() + expires_in * 1000),
    };
  }

  async refreshAccess(refreshToken: string): Promise<SpotifyTokens> {
    const { access_token, refresh_token, expires_in } = await this.tokenRequest(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })
    );

    return {
      accessToken: access_token,
      refreshToken: refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + expires_in * 1000),
    };
  }

  private async tokenRequest(body: URLSearchParams): Promise<SpotifyTokenResponse> {
    const basicAuthHeader = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    let response: Response;

    try {
      response = await fetch(SPOTIFY_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          Authorization: `Basic ${basicAuthHeader}`,
        },
        body,
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      throw SpotifyAuthError.failedRequest(error);
    }

    if (!response.ok) {
      throw await SpotifyAuthError.wrap(response);
    }

    return (await response.json()) as SpotifyTokenResponse;
  }
}
