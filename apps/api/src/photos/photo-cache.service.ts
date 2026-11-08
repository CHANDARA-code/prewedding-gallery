import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type { PhotoListDto } from '../common/photo.dto';

/**
 * In-process cache for guest list pages. Keys embed a version counter that is bumped on every
 * photo mutation, which invalidates all cached pages at once (spec 6.7.3).
 */
@Injectable()
export class PhotoCacheService {
  private version = 1;
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  private key(limit: number, cursor?: string) {
    return `photos:list:v${this.version}:${limit}:${cursor ?? ''}`;
  }

  get(limit: number, cursor?: string) {
    return this.cache.get<PhotoListDto>(this.key(limit, cursor));
  }

  set(limit: number, cursor: string | undefined, value: PhotoListDto) {
    return this.cache.set(this.key(limit, cursor), value, 30_000);
  }

  bump() {
    this.version++;
  }
}
