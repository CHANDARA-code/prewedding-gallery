/** Domain events emitted through @nestjs/event-emitter and picked up by AlertsListener. */
export const AppEvents = {
  AppStarted: 'app.started',
  AppError: 'app.error',
  LoginSucceeded: 'auth.login.succeeded',
  LoginFailed: 'auth.login.failed',
  LoginThrottled: 'auth.login.throttled',
  PhotosUploaded: 'photo.uploaded',
  PhotoUpdated: 'photo.updated',
  PhotoRotated: 'photo.rotated',
  PhotosRotated: 'photo.rotated_many',
  PhotosBatch: 'photo.batch',
  CollectionBatch: 'collection.batch',
  PhotosExported: 'photo.exported',
  PhotoSoftDeleted: 'photo.soft_deleted',
  PhotoRestored: 'photo.restored',
  PhotoHardDeleted: 'photo.hard_deleted',
  UserChanged: 'user.changed',
  AlbumChanged: 'album.changed',
  ShareChanged: 'share.changed',
  FavoriteAdded: 'favorite.added',
  FavoriteRemoved: 'favorite.removed',
  SaveAdded: 'save.added',
  SaveRemoved: 'save.removed',
} as const;

export interface Actor {
  id: number;
  username: string;
  role: string;
}

export interface LoginEvent {
  username: string;
  ip?: string;
  userAgent?: string;
  /** Failed logins only. */
  reason?: 'unknown_user' | 'wrong_password' | 'disabled';
  attempt?: number;
  maxAttempts?: number;
  locked?: boolean;
}
export interface PhotosUploadedEvent {
  actor: Actor;
  photoIds: number[];
  totalBytes: number;
}
export interface PhotoEvent {
  actor: Actor;
  photoId: number;
  title?: string | null;
  rotation?: number;
}
export interface PhotosRotatedEvent {
  actor: Actor;
  photoIds: number[];
  degrees: number;
}
export interface PhotosBatchEvent {
  actor: Actor;
  action: 'edited' | 'trashed' | 'restored' | 'purged';
  photoIds: number[];
}
export interface CollectionBatchEvent {
  actor: Actor;
  kind: 'favorites' | 'saves';
  on: boolean;
  count: number;
}
export interface PhotosExportedEvent {
  actor: Actor;
  rows: number;
  status: string;
}
export interface UserChangedEvent {
  actor: Actor;
  target: string;
  change: string;
}
export interface AlbumChangedEvent {
  actor: Actor;
  album: string;
  change: string;
}
export interface ShareChangedEvent {
  actor: Actor;
  change: 'created' | 'updated' | 'deleted';
  title: string | null;
  photoCount: number;
  visibility: 'public' | 'private';
  people: string[];
  expiresAt: string | null;
}

export interface ErrorEvent {
  method?: string;
  path?: string;
  status?: number;
  message: string;
  stack?: string;
}
