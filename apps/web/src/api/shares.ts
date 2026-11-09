import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { MyShares, Person, Share, ShareVisibility } from './types';

export const sharesKey = ['shares'] as const;
const shareKey = (token: string) => ['shares', 'one', token] as const;

/** Full link for a share, for copying or sending. */
export const shareLinkUrl = (s: Pick<Share, 'path'>) => `${window.location.origin}${s.path}`;

/** A share link by token. Errors: 401 (log in), 403 (not for you), 404 (gone), 410 (expired). */
export function useShare(token: string, userId: number | null, enabled = true) {
  return useQuery({
    // Who is asking changes the answer (private links), so the user is part of the key.
    queryKey: [...shareKey(token), userId],
    queryFn: ({ signal }) => api.get<Share>(`/shares/${encodeURIComponent(token)}`, { signal }).then((r) => r.data),
    staleTime: 30_000,
    retry: false,
    enabled,
  });
}

export function useMyShares(enabled = true) {
  return useQuery({
    queryKey: [...sharesKey, 'mine'],
    queryFn: ({ signal }) => api.get<MyShares>('/me/shares', { signal }).then((r) => r.data),
    staleTime: 15_000,
    enabled,
  });
}

/** Accounts a private link can go to. */
export function usePeople(enabled = true) {
  return useQuery({
    queryKey: ['people'],
    queryFn: ({ signal }) => api.get<Person[]>('/shares/people', { signal }).then((r) => r.data),
    staleTime: 60_000,
    enabled,
  });
}

export interface ShareInput {
  title?: string | null;
  visibility?: ShareVisibility;
  userIds?: number[];
  /** null = never expires. */
  expiresInDays?: number | null;
}

export function useCreateShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ShareInput & { photoIds: number[] }) => api.post<Share>('/shares', input).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: sharesKey }),
  });
}

export function useUpdateShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: ShareInput & { id: number }) => api.patch<Share>(`/shares/${id}`, input).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: sharesKey }),
  });
}

export function useDeleteShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (share: Pick<Share, 'id' | 'token'>) => api.delete(`/shares/${share.id}`),
    onSuccess: (_r, share) => {
      qc.removeQueries({ queryKey: ['photos', 'share', share.token] });
      qc.invalidateQueries({ queryKey: sharesKey });
    },
  });
}
