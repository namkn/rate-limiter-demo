import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RateLimitGuard } from '../token-bucket/rate-limit.guard.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  create() {
    return this.usersService.create();
  }

  @Get()
  list() {
    return this.usersService.list();
  }

  @Get(':id/greeting')
  @UseGuards(RateLimitGuard)
  greeting(@Param('id') id: string) {
    return this.usersService.greeting(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    this.usersService.remove(id);
  }
}
