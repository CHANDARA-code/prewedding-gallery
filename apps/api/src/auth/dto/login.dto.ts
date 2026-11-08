import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { ALL_PERMISSIONS, type Permission } from '../permissions';

export class LoginDto {
  @ApiProperty({ example: 'demo' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username: string;

  @ApiProperty({ example: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password: string;
}

export class UserDto {
  @ApiProperty({ example: 1 }) id: number;
  @ApiProperty({ example: 'demo' }) username: string;
  @ApiProperty({ enum: ['user', 'admin'], example: 'user' }) role: 'user' | 'admin';
  @ApiProperty({
    enum: ALL_PERMISSIONS,
    isArray: true,
    example: [],
    description: 'Effective permissions. Admins have all of them; users only those granted. Viewing, favorites, saves and sharing need none.',
  })
  permissions: Permission[];
}

export class LoginResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }) accessToken: string;
  @ApiProperty({ example: 'Bearer' }) tokenType: 'Bearer';
  @ApiProperty({ example: 3600, description: 'Token lifetime in seconds' }) expiresIn: number;
  @ApiProperty({ type: UserDto }) user: UserDto;
}
