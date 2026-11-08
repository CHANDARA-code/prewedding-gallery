import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

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
}

export class LoginResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }) accessToken: string;
  @ApiProperty({ example: 'Bearer' }) tokenType: 'Bearer';
  @ApiProperty({ example: 3600, description: 'Token lifetime in seconds' }) expiresIn: number;
  @ApiProperty({ type: UserDto }) user: UserDto;
}
