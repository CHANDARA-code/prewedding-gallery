import {
  InfiniteData,
  QueryClient,
  QueryKey,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from './client';
import { API_URL, PAGE_SIZE } from '../config';
import type { AdminStatus, Photo, PhotoPage, Scope } from './types';

type Pages = InfiniteData<PhotoPage, string | undefined>;

export function endpointFor(scope: Scope, album?: string): string {
  switch (scope) {
    case 'album':
      return `/albums/${encodeURIComponent(album ?? '')}/photos`;
    case 'favorite':
      return '/me/favorites';
    case 'save':
      return '/me/saves';
    case 'admin':
      return '/admin/photos';
    default:
      return '/photos';
  }
}

export const photosKey = (scope: Scope, status?: AdminStatus, album?: string): QueryKey =>
  scope === 'admin' ? ['photos', scope, status ?? 'active'] : scope === 'album' ? ['photos', scope, album] : ['photos', scope];

/** `album` is the album's slug (scope 'album' only). */
export function usePhotoList(scope: Scope, status?: AdminStatus, enabled = true, album?: string) {
  return useInfiniteQuery({
    queryKey: photosKey(scope, status, album),
    queryFn: ({ pageParam, signal }) =>
      api
        .get<PhotoPage>(endpointFor(scope, album), {
          params: { limit: PAGE_SIZE, cursor: pageParam, status: scope === 'admin' ? status : undefined },
          signal,
        })
        .then((r) => r.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    enabled,
  });
}

/** Flattens loaded pages, de-duplicated by id as a safety net. */
export function flattenPages(data: InfiniteData<PhotoPage, unknown> | undefined): Photo[] {
  if (!data) return [];
  const seen = new Set<number>();
  const out: Photo[] = [];
  for (const page of data.pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

/** Viewer image: the preview when the API has one, else the original. */
export const viewUrl = (p: Photo) => p.previewUrl || p.url;

export const photoKey = (id: number) => ['photo', id] as const;

/** Photo detail (EXIF, size, type; original name for admins). Seeded from list data when available. */
export function usePhotoDetail(id: number | null, seed?: Photo) {
  return useQuery({
    queryKey: photoKey(id ?? 0),
    queryFn: ({ signal }) => api.get<Photo>(`/photos/${id}`, { signal }).then((r) => r.data),
    enabled: id !== null,
    staleTime: 5 * 60_000,
    placeholderData: seed,
  });
}

/* ---------- cache helpers ---------- */

type ItemUpdater = (item: Photo, key: QueryKey) => Photo | null;

/** Maps every cached `['photos', …]` list in place. Returning null removes the item. */
function updateCachedPhotos(qc: QueryClient, fn: ItemUpdater) {
  for (const [key, data] of qc.getQueriesData<Pages>({ queryKey: ['photos'] })) {
    if (!data?.pages) continue;
    let changed = false;
    const pages = data.pages.map((page) => {
      const items: Photo[] = [];
      for (const item of page.items) {
        const next = fn(item, key);
        if (next !== item) changed = true;
        if (next) items.push(next);
      }
      return { ...page, items };
    });
    if (changed) qc.setQueryData<Pages>(key, { ...data, pages });
  }
}

const snapshot = (qc: QueryClient) => qc.getQueriesData<Pages>({ queryKey: ['photos'] });
const restore = (qc: QueryClient, snap: ReturnType<typeof snapshot>) => {
  for (const [key, data] of snap) qc.setQueryData(key, data);
};

/* ---------- favorite / save toggles (optimistic) ---------- */

type ToggleKind = 'favorite' | 'save';
const flagOf = (kind: ToggleKind) => (kind === 'favorite' ? 'isFavorite' : 'isSaved');

export function useToggle(kind: ToggleKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ photo, on }: { photo: Photo; on: boolean }) =>
      on ? api.put(`/photos/${photo.id}/${kind}`) : api.delete(`/photos/${photo.id}/${kind}`),
    onMutate: async ({ photo, on }) => {
      await qc.cancelQueries({ queryKey: ['photos'] });
      const snap = snapshot(qc);
      const flag = flagOf(kind);
      updateCachedPhotos(qc, (item, key) => {
        if (item.id !== photo.id) return item;
        // Un-favoriting removes it from the Favorite tab (same for Save).
        if (!on && key[1] === kind) return null;
        return { ...item, [flag]: on };
      });
      const detail = qc.getQueryData<Photo>(photoKey(photo.id));
      if (detail) qc.setQueryData<Photo>(photoKey(photo.id), { ...detail, [flag]: on });
      return { snap, detail };
    },
    onError: (_err, { photo }, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      if (ctx?.detail) qc.setQueryData(photoKey(photo.id), ctx.detail);
    },
    onSuccess: (_res, { on }) => {
      // Favoriting adds nothing to the Favorite tab's cache; refetch it fresh when next opened.
      if (on) qc.invalidateQueries({ queryKey: ['photos', kind], refetchType: 'none' });
    },
  });
}

/* ---------- admin mutations ---------- */

export function useSoftDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photo: Photo) => api.delete<Photo>(`/admin/photos/${photo.id}`).then((r) => r.data),
    onSuccess: (updated, photo) => {
      const deletedAt = updated?.deletedAt ?? new Date().toISOString();
      updateCachedPhotos(qc, (item, key) => {
        if (item.id !== photo.id) return item;
        if (key[1] === 'admin' && key[2] === 'all') return { ...item, deletedAt };
        return null;
      });
      qc.invalidateQueries({ queryKey: ['photos', 'admin', 'deleted'], refetchType: 'none' });
      qc.invalidateQueries({ queryKey: ['albums'] }); // counts and covers
    },
  });
}

export function useRestore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photo: Photo) => api.post<Photo>(`/admin/photos/${photo.id}/restore`).then((r) => r.data),
    onSuccess: (_updated, photo) => {
      updateCachedPhotos(qc, (item, key) => {
        if (item.id !== photo.id) return item;
        if (key[1] === 'admin' && key[2] === 'all') return { ...item, deletedAt: null };
        return null;
      });
      // It reappears in lists it used to be in: refetch those lazily.
      for (const scope of ['all', 'favorite', 'save', 'album'] as const) {
        qc.invalidateQueries({ queryKey: ['photos', scope], refetchType: 'none' });
      }
      qc.invalidateQueries({ queryKey: ['photos', 'admin', 'active'], refetchType: 'none' });
      qc.invalidateQueries({ queryKey: ['albums'] });
    },
  });
}

export function useHardDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photo: Photo) => api.delete(`/admin/photos/${photo.id}/permanent`),
    onSuccess: (_res, photo) => {
      updateCachedPhotos(qc, (item) => (item.id === photo.id ? null : item));
      qc.invalidateQueries({ queryKey: ['albums'] });
    },
  });
}

export function useUpdatePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title, caption }: { id: number; title?: string; caption?: string }) =>
      api.patch<Photo>(`/admin/photos/${id}`, { title, caption }).then((r) => r.data),
    onSuccess: (updated) => {
      updateCachedPhotos(qc, (item) =>
        item.id === updated.id ? { ...item, title: updated.title, caption: updated.caption } : item,
      );
      qc.setQueryData<Photo>(photoKey(updated.id), (old) => (old ? { ...old, title: updated.title, caption: updated.caption } : old));
    },
  });
}

/** Copies a rotation's new rendering (size, thumbnail, preview) into every cached list and the detail. */
function applyRotated(qc: QueryClient, u: Photo) {
  const patch = { width: u.width, height: u.height, thumbUrl: u.thumbUrl, previewUrl: u.previewUrl, rotation: u.rotation };
  updateCachedPhotos(qc, (item) => (item.id === u.id ? { ...item, ...patch } : item));
  qc.setQueryData<Photo>(photoKey(u.id), (old) => (old ? { ...old, ...patch } : u));
}

export function useRotate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, degrees }: { id: number; degrees: 90 | -90 | 180 }) =>
      api.post<Photo>(`/admin/photos/${id}/rotate`, { degrees }).then((r) => r.data),
    onSuccess: (u) => applyRotated(qc, u),
    // An album cover may be one of them.
    onSettled: () => qc.invalidateQueries({ queryKey: ['albums'] }),
  });
}

/** Photos per rotate request: each takes the server about a second to re-render. */
export const ROTATE_BATCH = 8;

export interface RotateManyResult {
  rotated: number;
  /** Ids the server couldn't re-render, plus any not sent because a request failed. */
  failed: number[];
  /** Set when a request failed part-way; photos before it were rotated. */
  error?: unknown;
}

/** Rotates a selection in batches, updating the grid as each batch comes back. */
export function useRotateMany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ids,
      degrees,
      onProgress,
    }: {
      ids: number[];
      degrees: 90 | -90 | 180;
      onProgress?: (done: number, total: number) => void;
    }): Promise<RotateManyResult> => {
      const result: RotateManyResult = { rotated: 0, failed: [] };
      for (let i = 0; i < ids.length; i += ROTATE_BATCH) {
        const batch = ids.slice(i, i + ROTATE_BATCH);
        try {
          const { data } = await api.post<{ photos: Photo[]; failed: number[] }>('/admin/photos/rotate', { photoIds: batch, degrees });
          data.photos.forEach((u) => applyRotated(qc, u));
          result.rotated += data.photos.length;
          result.failed.push(...data.failed);
        } catch (error) {
          result.failed.push(...ids.slice(i));
          result.error = error;
          break;
        }
        onProgress?.(Math.min(i + ROTATE_BATCH, ids.length), ids.length);
      }
      return result;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['albums'] }),
  });
}

/** Downloads the admin CSV export (bearer auth, so it goes through axios rather than a plain link). */
export interface CsvExport {
  status?: AdminStatus;
  /** Only photos someone favorited / saved. */
  collection?: 'all' | 'favorites' | 'saves';
  /** With a collection: only the signed-in user's own. */
  mine?: boolean;
  /** Only photos in this album (its id). */
  album?: number;
  /** Only these photos (a selection). */
  ids?: number[];
}

export async function downloadPhotosCsv({ status = 'all', collection = 'all', mine = false, album, ids }: CsvExport = {}) {
  const params = {
    status,
    ...(collection !== 'all' && { collection, mine }),
    ...(album !== undefined && { album }),
    ...(ids?.length && { ids: ids.join(',') }),
  };
  const res = await api.get<Blob>('/admin/photos/export.csv', { params, responseType: 'blob' });
  const disposition = String(res.headers['content-disposition'] ?? '');
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `prewedding-photos-${status}.csv`;
  const href = URL.createObjectURL(res.data);
  const a = Object.assign(document.createElement('a'), { href, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return name;
}

export function useUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      files,
      title,
      caption,
      onProgress,
    }: {
      files: File[];
      title?: string;
      caption?: string;
      onProgress?: (percent: number) => void;
    }) => {
      const form = new FormData();
      for (const f of files) form.append('files', f);
      if (title) form.append('title', title);
      if (caption) form.append('caption', caption);
      return api
        .post<Photo[]>('/admin/photos', form, {
          onUploadProgress: (e) => {
            if (e.total) onProgress?.(Math.round((e.loaded / e.total) * 100));
          },
        })
        .then((r) => r.data);
    },
    onSuccess: () => {
      // Lists restart from the first page so the new photos appear at the top.
      qc.resetQueries({ queryKey: ['photos'] });
    },
  });
}

/* ---------- selection batches ---------- */

/** Most photos per ZIP (the API's limit); bigger selections download as several ZIPs. */
export const ZIP_MAX = 200;

/**
 * Downloads the originals of `ids` as ZIPs through a plain link, so the browser streams them to disk
 * with its own progress bar. Returns how many ZIPs were started.
 */
export function downloadPhotosZip(ids: number[]): number {
  const parts: number[][] = [];
  for (let i = 0; i < ids.length; i += ZIP_MAX) parts.push(ids.slice(i, i + ZIP_MAX));
  parts.forEach((part, i) =>
    // Browsers drop back-to-back downloads; space them out.
    setTimeout(() => {
      const a = Object.assign(document.createElement('a'), { href: `${API_URL}/photos/download.zip?ids=${part.join(',')}`, download: '' });
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, i * 1500),
  );
  return parts.length;
}

/** Favorite / save (or undo) every selected photo in one request. */
export function useBatchToggle(kind: ToggleKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, on }: { ids: number[]; on: boolean }) =>
      api.post<{ changed: number }>(`/me/${kind === 'favorite' ? 'favorites' : 'saves'}/batch`, { photoIds: ids, on }).then((r) => r.data),
    onSuccess: (_res, { ids, on }) => {
      const flag = flagOf(kind);
      const set = new Set(ids);
      updateCachedPhotos(qc, (item, key) => {
        if (!set.has(item.id)) return item;
        if (!on && key[1] === kind) return null;
        return { ...item, [flag]: on };
      });
      for (const id of ids) {
        const detail = qc.getQueryData<Photo>(photoKey(id));
        if (detail) qc.setQueryData<Photo>(photoKey(id), { ...detail, [flag]: on });
      }
      if (on) qc.invalidateQueries({ queryKey: ['photos', kind], refetchType: 'none' });
    },
  });
}

export type AdminBatch = 'trash' | 'restore' | 'purge';

/** Trash / restore / permanently delete a selection; every list and album refreshes. */
export function useAdminBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ids }: { action: AdminBatch; ids: number[] }) =>
      api.post<{ changed: number }>(`/admin/photos/${action}`, { photoIds: ids }).then((r) => r.data),
    onSuccess: (_res, { ids }) => {
      qc.invalidateQueries({ queryKey: ['photos'] });
      qc.invalidateQueries({ queryKey: ['albums'] });
      for (const id of ids) qc.removeQueries({ queryKey: photoKey(id) });
    },
  });
}

/** Sets the title and/or caption of a selection (undefined keeps, '' clears). */
export function useBatchEdit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, title, caption }: { ids: number[]; title?: string; caption?: string }) =>
      api.patch<{ changed: number }>('/admin/photos', { photoIds: ids, title, caption }).then((r) => r.data),
    onSuccess: (_res, { ids, title, caption }) => {
      const set = new Set(ids);
      const patch = {
        ...(title !== undefined && { title: title || null }),
        ...(caption !== undefined && { caption: caption || null }),
      };
      updateCachedPhotos(qc, (item) => (set.has(item.id) ? { ...item, ...patch } : item));
      for (const id of ids) qc.setQueryData<Photo>(photoKey(id), (old) => (old ? { ...old, ...patch } : old));
    },
  });
}
