export type Role = 'user' | 'admin';

export interface User {
  id: number;
  username: string;
  role: Role;
}

export interface Photo {
  id: number;
  title: string | null;
  caption: string | null;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  createdAt: string;
  /** Present only when a valid token was sent. */
  isFavorite?: boolean;
  isSaved?: boolean;
  /** Only ever non-null on admin responses. */
  deletedAt?: string | null;
}

export interface PhotoPage {
  items: Photo[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: User;
}

export type Scope = 'all' | 'favorite' | 'save' | 'admin';
export type AdminStatus = 'active' | 'deleted' | 'all';

export interface ApiError {
  statusCode: number;
  error: string;
  message: string | string[];
}
