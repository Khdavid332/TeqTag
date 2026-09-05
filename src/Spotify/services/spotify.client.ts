import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import { SPOTIFY_API_URL_V1 } from '../constants/spotify.constants';
import { SpotifyApiError } from '../exceptions/spotify.error';
import { SpotifySavedTracksResponse } from '../interfaces/spotify.interface';
import spotifyConfig from '../spotify.config';

@Injectable()
export class SpotifyClient {
  constructor(
    @Inject(spotifyConfig.KEY)
    private readonly config: ConfigType<typeof spotifyConfig>
  ) {}

  async getSavedTracks(
    accessToken: string,
    limit = 50,
    offset = 0
  ): Promise<SpotifySavedTracksResponse> {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });

    return this.request<SpotifySavedTracksResponse>(`/me/tracks?${params}`, accessToken);
  }

  private async request<T>(path: string, accessToken: string): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${SPOTIFY_API_URL_V1}${path}`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(this.config.timeout),
      });
    } catch (error) {
      throw SpotifyApiError.failedRequest(error);
    }

    if (!response.ok) {
      throw await SpotifyApiError.wrap(response);
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      throw SpotifyApiError.failedRequest(error);
    }
  }
}
