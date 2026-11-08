/** Domain events emitted through @nestjs/event-emitter and picked up by AlertsListener. */
export const AppEvents = {
  AppStarted: 'app.started',
  AppError: 'app.error',
  LoginSucceeded: 'auth.login.succeeded',
  LoginFailed: 'auth.login.failed',
  LoginThrottled: 'auth.login.throttled',
  PhotosUploaded: 'photo.uploaded',
  PhotoUpdated: 'photo.updated',
  PhotoSoftDeleted: 'photo.soft_deleted',
  PhotoRestored: 'photo.restored',
  PhotoHardDeleted: 'photo.hard_deleted',
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
}
export interface ErrorEvent {
  method?: string;
  path?: string;
  status?: number;
  message: string;
  stack?: string;
}
