import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ALL_PERMISSIONS, GRANTABLE_PERMISSIONS, PERMISSIONS, type Permission } from '../auth/permissions';
import { PASSWORD_MAX, PASSWORD_MIN, ROLES, USERNAME_RE } from './users.core';
import type { Role } from '../db/schema';

const trimLower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class PermissionInfoDto {
  @ApiProperty({ example: 'photos.upload' }) key: Permission;
  @ApiProperty({ example: 'Upload photos' }) label: string;
  @ApiProperty({ description: 'False for admin-only permissions (users.manage)' }) grantable: boolean;
}

export class UserAdminDto {
  @ApiProperty({ example: 3 }) id: number;
  @ApiProperty({ example: 'dara' }) username: string;
  @ApiProperty({ enum: ROLES, example: 'user' }) role: Role;
  @ApiProperty({ enum: GRANTABLE_PERMISSIONS, isArray: true, example: ['photos.upload'], description: 'Extra actions granted to a user role. Ignored for admins.' })
  grants: Permission[];
  @ApiProperty({ enum: ALL_PERMISSIONS, isArray: true, example: ['photos.upload'], description: 'What the account can actually do.' })
  permissions: Permission[];
  @ApiProperty({ example: false }) disabled: boolean;
  @ApiProperty({ example: '2026-11-08T03:00:00.000Z' }) createdAt: string;
  @ApiProperty({ example: null, nullable: true, type: String }) lastLoginAt: string | null;
  @ApiProperty({ example: 0 }) photosUploaded: number;
}

export class UserWithPasswordDto {
  @ApiProperty({ type: UserAdminDto }) user: UserAdminDto;
  @ApiPropertyOptional({ example: 'q8Zr0f2KxN4bYw1c', description: 'Present only when the server generated the password. Shown once; it is not stored.' })
  generatedPassword?: string;
}

export class CreateUserDto {
  @ApiProperty({ example: 'dara', description: 'Stored lowercase. 2-32 characters: letters, digits, dot, dash, underscore.' })
  @Transform(trimLower)
  @IsString()
  @Matches(USERNAME_RE, { message: 'Username must be 2-32 characters: letters, digits, dot, dash or underscore, starting with a letter or digit' })
  username: string;

  @ApiPropertyOptional({ description: `${PASSWORD_MIN}-${PASSWORD_MAX} characters. Omit to have a strong one generated.` })
  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password?: string;

  @ApiProperty({ enum: ROLES, example: 'user' })
  @IsIn(ROLES)
  role: Role;

  @ApiPropertyOptional({ enum: GRANTABLE_PERMISSIONS, isArray: true, example: ['photos.upload'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(GRANTABLE_PERMISSIONS, { each: true })
  grants?: Permission[];
}

export class UpdateUserDto {
  @ApiPropertyOptional({ enum: ROLES })
  @IsOptional()
  @IsIn(ROLES)
  role?: Role;

  @ApiPropertyOptional({ enum: GRANTABLE_PERMISSIONS, isArray: true, description: 'Replaces the grant list.' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(GRANTABLE_PERMISSIONS, { each: true })
  grants?: Permission[];

  @ApiPropertyOptional({ description: 'Disabling signs the account out everywhere and blocks login.' })
  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}

export class ResetPasswordDto {
  @ApiPropertyOptional({ description: `${PASSWORD_MIN}-${PASSWORD_MAX} characters. Omit to have a strong one generated.` })
  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password?: string;
}

export const PERMISSION_INFO: PermissionInfoDto[] = ALL_PERMISSIONS.map((key) => ({
  key,
  label: PERMISSIONS[key],
  grantable: GRANTABLE_PERMISSIONS.includes(key),
}));
