import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Album } from './types';

export const albumsKey = ['albums'] as const;
const albumKey = (slug: string) => ['albums', 'one', slug] as const;

/** Every album the caller may see (album managers also get hidden ones). */
export function useAlbums(enabled = true) {
  return useQuery({
    queryKey: [...albumsKey, 'list'],
    queryFn: ({ signal }) => api.get<Album[]>('/albums', { signal }).then((r) => r.data),
    staleTime: 30_000,
    enabled,
  });
}

export function useAlbum(slug: string) {
  return useQuery({
    queryKey: albumKey(slug),
    queryFn: ({ signal }) => api.get<Album>(`/albums/${encodeURIComponent(slug)}`, { signal }).then((r) => r.data),
    staleTime: 30_000,
  });
}

/**
 * After an album changes: album lists/details refetch, and photo details refetch their `albums` list.
 * `photosOf` (an album slug) also restarts that album's photo grid.
 */
function afterAlbumChange(qc: QueryClient, { photosOf, photoIds }: { photosOf?: string; photoIds?: number[] } = {}) {
  qc.invalidateQueries({ queryKey: albumsKey });
  if (photosOf) qc.invalidateQueries({ queryKey: ['photos', 'album', photosOf] });
  for (const id of photoIds ?? []) qc.invalidateQueries({ queryKey: ['photo', id] });
}

export interface AlbumInput {
  name?: string;
  description?: string | null;
  slug?: string;
  hidden?: boolean;
  coverPhotoId?: number | null;
}

export function useCreateAlbum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AlbumInput & { name: string; photoIds?: number[] }) => api.post<Album>('/admin/albums', input).then((r) => r.data),
    onSuccess: (album, input) => {
      qc.setQueryData(albumKey(album.slug), album);
      afterAlbumChange(qc, { photoIds: input.photoIds });
    },
  });
}

export function useUpdateAlbum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: AlbumInput & { id: number }) => api.patch<Album>(`/admin/albums/${id}`, input).then((r) => r.data),
    onSuccess: (album) => {
      qc.setQueryData(albumKey(album.slug), album);
      afterAlbumChange(qc);
    },
  });
}

export function useDeleteAlbum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (album: Album) => api.delete(`/admin/albums/${album.id}`),
    onSuccess: (_r, album) => {
      qc.removeQueries({ queryKey: albumKey(album.slug) });
      qc.removeQueries({ queryKey: ['photos', 'album', album.slug] });
      qc.invalidateQueries({ queryKey: albumsKey });
      qc.invalidateQueries({ queryKey: ['photo'] });
    },
  });
}

interface AlbumPhotosResult {
  changed: number;
  album: Album;
}

/** Adds (`remove: false`) or removes photos; idempotent on the server. */
export function useAlbumPhotos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ album, photoIds, remove }: { album: Pick<Album, 'id' | 'slug'>; photoIds: number[]; remove?: boolean }) =>
      api.post<AlbumPhotosResult>(`/admin/albums/${album.id}/photos${remove ? '/remove' : ''}`, { photoIds }).then((r) => r.data),
    onSuccess: (res, { photoIds }) => {
      qc.setQueryData(albumKey(res.album.slug), res.album);
      afterAlbumChange(qc, { photosOf: res.album.slug, photoIds });
    },
  });
}
