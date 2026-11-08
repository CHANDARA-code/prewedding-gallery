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
  /** The untouched original (download / full-resolution zoom). */
  url: string;
  /** 2048px WebP for viewing, rotation applied (falls back to `url` on older API data). */
  previewUrl?: string;
  thumbUrl: string;
  /** Displayed size, EXIF orientation and admin rotation applied. */
  width: number;
  height: number;
  rotation?: number;
  createdAt: string;
  /** Present only when a valid token was sent. */
  isFavorite?: boolean;
  isSaved?: boolean;
  /** Only ever non-null on admin responses. */
  deletedAt?: string | null;
  /** Detail responses only. */
  mimeType?: string;
  sizeBytes?: number;
  exif?: PhotoExif | null;
  /** Admin detail only. */
  originalName?: string | null;
  uploadedBy?: number;
}

export interface PhotoExif {
  make?: string;
  model?: string;
  lens?: string;
  focalLength?: number;
  fNumber?: number;
  exposureTime?: number;
  iso?: number;
  exposureBias?: number;
  flash?: boolean;
  takenAt?: string;
  software?: string;
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
