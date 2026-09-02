import { Module } from '@nestjs/common';
import { SpotifyController } from './spotify.controller';
import { SpotifyService } from './services/spotify.service';
import { TokenStoreService } from './services/token-store.service';
import { SPOTIFY_TOKEN_STORE } from './constants/spotify.constants';

@Module({
  controllers: [SpotifyController],
  providers: [
    SpotifyService,
    TokenStoreService,
    {
      provide: SPOTIFY_TOKEN_STORE,
      useExisting: TokenStoreService,
    },
  ],
  exports: [SpotifyService, TokenStoreService, SPOTIFY_TOKEN_STORE],
})
export class SpotifyModule {}
