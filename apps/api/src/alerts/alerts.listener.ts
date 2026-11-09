import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AlertsService } from './alerts.service';
import { escapeHtml as e } from './telegram.client';
import {
  Actor,
  AlbumChangedEvent,
  CollectionBatchEvent,
  AppEvents,
  ErrorEvent,
  LoginEvent,
  PhotoEvent,
  PhotosBatchEvent,
  PhotosExportedEvent,
  PhotosRotatedEvent,
  PhotosUploadedEvent,
  UserChangedEvent,
} from './events';

const who = (a: Actor) => `<b>${e(a.username)}</b>${a.role === 'admin' ? ' (admin)' : ''}`;
const idList = (ids: number[]) => (ids.length > 12 ? `${ids.slice(0, 12).join(', ')}…` : ids.join(', '));
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Listens to domain events and turns them into Telegram alerts. */
@Injectable()
export class AlertsListener {
  constructor(private readonly alerts: AlertsService) {}

  @OnEvent(AppEvents.AppStarted)
  onStarted(p: { url: string; photos: number }) {
    this.alerts.notify('system', `🟢 API started · ${e(p.url)} · ${p.photos} active photos`);
  }

  @OnEvent(AppEvents.AppError)
  onError(p: ErrorEvent) {
    const where = p.method ? `${e(p.method)} ${e(p.path)} → ${p.status ?? 500}\n` : '';
    const stack = p.stack ? `\n<pre>${e(p.stack.split('\n').slice(0, 6).join('\n'))}</pre>` : '';
    this.alerts.notify('error', `🚨 <b>Server error</b>\n${where}${e(p.message)}${stack}`);
  }

  @OnEvent(AppEvents.LoginSucceeded)
  onLogin(p: LoginEvent) {
    this.alerts.notify('auth', `🔑 Login: <b>${e(p.username)}</b> from ${e(p.ip ?? '?')}`);
  }

  @OnEvent(AppEvents.LoginFailed)
  onLoginFailed(p: LoginEvent) {
    const why = p.reason === 'unknown_user' ? 'no such account' : p.reason === 'wrong_password' ? 'wrong password' : p.reason === 'disabled' ? 'account disabled' : '';
    const count = p.attempt ? ` · attempt ${p.attempt}/${p.maxAttempts}` : '';
    const ua = p.userAgent ? `\n<i>${e(p.userAgent.slice(0, 120))}</i>` : '';
    const lock = p.locked ? `\n🔒 Locked <b>${e(p.username)}</b> from ${e(p.ip ?? '?')} for 15 min` : '';
    this.alerts.notify(
      'auth',
      `${p.locked ? '🔒' : '⚠️'} Failed login for <b>${e(p.username)}</b> from ${e(p.ip ?? '?')}${why ? ` (${why})` : ''}${count}${ua}${lock}`,
    );
  }

  @OnEvent(AppEvents.LoginThrottled)
  onLoginThrottled(p: LoginEvent) {
    this.alerts.notify('auth', `⛔ Login rate limit hit from ${e(p.ip ?? '?')} (possible brute force)`);
  }

  @OnEvent(AppEvents.PhotosUploaded)
  onUploaded(p: PhotosUploadedEvent) {
    this.alerts.notify(
      'admin',
      `📤 ${who(p.actor)} uploaded ${p.photoIds.length} photo(s), ${mb(p.totalBytes)} · ids ${p.photoIds.join(', ')}`,
    );
  }

  @OnEvent(AppEvents.PhotoUpdated)
  onUpdated(p: PhotoEvent) {
    this.alerts.notify('admin', `✏️ ${who(p.actor)} edited photo #${p.photoId}`);
  }

  @OnEvent(AppEvents.PhotoRotated)
  onRotated(p: PhotoEvent) {
    this.alerts.notify('admin', `🔄 ${who(p.actor)} rotated photo #${p.photoId} to ${p.rotation}°`);
  }

  @OnEvent(AppEvents.PhotosRotated)
  onRotatedMany(p: PhotosRotatedEvent) {
    const dir = p.degrees === 180 ? '180°' : p.degrees > 0 ? 'right' : 'left';
    this.alerts.notify('admin', `🔄 ${who(p.actor)} rotated ${p.photoIds.length} photo(s) ${dir} · ids ${idList(p.photoIds)}`);
  }

  @OnEvent(AppEvents.PhotosBatch)
  onBatch(p: PhotosBatchEvent) {
    const verb = { edited: ['✏️', 'edited'], trashed: ['🗑️', 'moved to trash'], restored: ['♻️', 'restored'], purged: ['❌', 'permanently deleted'] }[p.action];
    this.alerts.notify('admin', `${verb[0]} ${who(p.actor)} ${verb[1]} ${p.photoIds.length} photo(s) · ids ${idList(p.photoIds)}`);
  }

  @OnEvent(AppEvents.CollectionBatch)
  onCollectionBatch(p: CollectionBatchEvent) {
    const icon = p.kind === 'favorites' ? (p.on ? '❤️' : '🤍') : p.on ? '🔖' : '📑';
    const verb = p.kind === 'favorites' ? (p.on ? 'favorited' : 'un-favorited') : p.on ? 'saved' : 'un-saved';
    this.alerts.notify('engagement', `${icon} ${who(p.actor)} ${verb} ${p.count} photo(s) at once`);
  }

  @OnEvent(AppEvents.UserChanged)
  onUserChanged(p: UserChangedEvent) {
    this.alerts.notify('admin', `👤 ${who(p.actor)} · user <b>${e(p.target)}</b>: ${e(p.change)}`);
  }

  @OnEvent(AppEvents.AlbumChanged)
  onAlbumChanged(p: AlbumChangedEvent) {
    this.alerts.notify('admin', `🗂️ ${who(p.actor)} · album <b>${e(p.album)}</b>: ${e(p.change)}`);
  }

  @OnEvent(AppEvents.PhotosExported)
  onExported(p: PhotosExportedEvent) {
    this.alerts.notify('admin', `📄 ${who(p.actor)} exported a CSV of ${p.rows} photo(s) (${e(p.status)})`);
  }

  @OnEvent(AppEvents.PhotoSoftDeleted)
  onSoftDeleted(p: PhotoEvent) {
    this.alerts.notify('admin', `🗑️ ${who(p.actor)} moved photo #${p.photoId} to trash`);
  }

  @OnEvent(AppEvents.PhotoRestored)
  onRestored(p: PhotoEvent) {
    this.alerts.notify('admin', `♻️ ${who(p.actor)} restored photo #${p.photoId}`);
  }

  @OnEvent(AppEvents.PhotoHardDeleted)
  onHardDeleted(p: PhotoEvent) {
    this.alerts.notify('admin', `❌ ${who(p.actor)} permanently deleted photo #${p.photoId}`);
  }

  @OnEvent(AppEvents.FavoriteAdded)
  onFavorite(p: PhotoEvent) {
    this.alerts.notify('engagement', `❤️ ${who(p.actor)} favorited photo #${p.photoId}`);
  }

  @OnEvent(AppEvents.FavoriteRemoved)
  onUnfavorite(p: PhotoEvent) {
    this.alerts.notify('engagement', `🤍 ${who(p.actor)} un-favorited photo #${p.photoId}`);
  }

  @OnEvent(AppEvents.SaveAdded)
  onSave(p: PhotoEvent) {
    this.alerts.notify('engagement', `🔖 ${who(p.actor)} saved photo #${p.photoId}`);
  }

  @OnEvent(AppEvents.SaveRemoved)
  onUnsave(p: PhotoEvent) {
    this.alerts.notify('engagement', `📑 ${who(p.actor)} un-saved photo #${p.photoId}`);
  }
}
