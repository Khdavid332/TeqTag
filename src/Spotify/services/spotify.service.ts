import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { SPOTIFY_AUTH_URL, SPOTIFY_TOKEN_URL } from '../constants/spotify.constants';
import { SpotifyTokens, SpotifyTokenResponse } from '../interfaces/spotify.interface';
import { SpotifyAuthError } from '../exceptions/spotify-auth.error';
import spotifyConfig from '../spotify.config';

@Injectable()
export class SpotifyService {
  constructor(
    @Inject(spotifyConfig.KEY)
    private readonly config: ConfigType<typeof spotifyConfig>
  ) {}

  authorization(state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      scope: this.config.scopes.join(' '),
      redirect_uri: this.config.redirectUrl,
      state,
    });

    return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<SpotifyTokens> {
    const { access_token, refresh_token, expires_in } = await this.tokenRequest(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.redirectUrl,
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
    const basicAuthHeader = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString('base64');

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
