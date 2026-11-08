import {
  InfiniteData,
  QueryClient,
  QueryKey,
  useInfiniteQuery,
  useMutation,
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
      return { snap };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) restore(qc, ctx.snap);
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
    },
  });
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
