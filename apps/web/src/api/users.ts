import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { ManagedUser, Permission, PermissionInfo, Role, UserWithPassword } from './types';

const KEY = ['admin-users'] as const;

export function useUsers() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => api.get<ManagedUser[]>('/admin/users', { signal }).then((r) => r.data),
    staleTime: 10_000,
  });
}

export function usePermissionCatalogue() {
  return useQuery({
    queryKey: [...KEY, 'permissions'],
    queryFn: ({ signal }) => api.get<PermissionInfo[]>('/admin/users/permissions', { signal }).then((r) => r.data),
    staleTime: Infinity,
  });
}

export interface CreateUserInput {
  username: string;
  role: Role;
  grants: Permission[];
  password?: string;
}

export interface UpdateUserInput {
  id: number;
  role?: Role;
  grants?: Permission[];
  disabled?: boolean;
}

function useUserMutation<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: KEY }) });
}

export const useCreateUser = () =>
  useUserMutation((input: CreateUserInput) => api.post<UserWithPassword>('/admin/users', input).then((r) => r.data));

export const useUpdateUser = () =>
  useUserMutation(({ id, ...patch }: UpdateUserInput) => api.patch<ManagedUser>(`/admin/users/${id}`, patch).then((r) => r.data));

export const useResetPassword = () =>
  useUserMutation(({ id, password }: { id: number; password?: string }) =>
    api.post<UserWithPassword>(`/admin/users/${id}/password`, password ? { password } : {}).then((r) => r.data),
  );

export const useDeleteUser = () => useUserMutation((id: number) => api.delete(`/admin/users/${id}`).then(() => id));
