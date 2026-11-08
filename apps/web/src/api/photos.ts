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
import { PAGE_SIZE } from '../config';
import type { AdminStatus, Photo, PhotoPage, Scope } from './types';

type Pages = InfiniteData<PhotoPage, string | undefined>;

export function endpointFor(scope: Scope): string {
  switch (scope) {
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

export const photosKey = (scope: Scope, status?: AdminStatus): QueryKey =>
  scope === 'admin' ? ['photos', scope, status ?? 'active'] : ['photos', scope];

export function usePhotoList(scope: Scope, status?: AdminStatus, enabled = true) {
  return useInfiniteQuery({
    queryKey: photosKey(scope, status),
    queryFn: ({ pageParam, signal }) =>
      api
        .get<PhotoPage>(endpointFor(scope), {
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
      for (const scope of ['all', 'favorite', 'save'] as const) {
        qc.invalidateQueries({ queryKey: ['photos', scope], refetchType: 'none' });
      }
      qc.invalidateQueries({ queryKey: ['photos', 'admin', 'active'], refetchType: 'none' });
    },
  });
}

export function useHardDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photo: Photo) => api.delete(`/admin/photos/${photo.id}/permanent`),
    onSuccess: (_res, photo) => {
      updateCachedPhotos(qc, (item) => (item.id === photo.id ? null : item));
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

/** Rotates how a photo is displayed everywhere; every cached list and detail picks up the new renderings. */
export function useRotate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, degrees }: { id: number; degrees: 90 | -90 | 180 }) =>
      api.post<Photo>(`/admin/photos/${id}/rotate`, { degrees }).then((r) => r.data),
    onSuccess: (u) => {
      const patch = { width: u.width, height: u.height, thumbUrl: u.thumbUrl, previewUrl: u.previewUrl, rotation: u.rotation };
      updateCachedPhotos(qc, (item) => (item.id === u.id ? { ...item, ...patch } : item));
      qc.setQueryData<Photo>(photoKey(u.id), (old) => (old ? { ...old, ...patch } : u));
    },
  });
}

/** Downloads the admin CSV export (bearer auth, so it goes through axios rather than a plain link). */
export interface CsvExport {
  status?: AdminStatus;
  /** Only photos someone favorited / saved. */
  collection?: 'all' | 'favorites' | 'saves';
  /** With a collection: only the signed-in user's own. */
  mine?: boolean;
}

export async function downloadPhotosCsv({ status = 'all', collection = 'all', mine = false }: CsvExport = {}) {
  const params = { status, ...(collection !== 'all' && { collection, mine }) };
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
