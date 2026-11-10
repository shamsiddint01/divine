import { Controller, Get, HttpCode, Patch, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CreateUserInput,
  createUserSchema,
  ErrorCode,
  type Paginated,
  type PasswordResetResponse,
  Permission,
  type ReplaceUserWarehousesInput,
  replaceUserWarehousesSchema,
  ROLE_CODES,
  type UpdateUserInput,
  updateUserSchema,
  type UpdateUserStatusInput,
  updateUserStatusSchema,
  type UserCreatedResponse,
  type UserDto,
  USER_STATUSES,
  uuidSchema,
  type WarehouseOption,
} from '@divine/shared';
import type { Request, Response } from 'express';
import type { AccessContext } from '../../common/auth/access-context.js';
import { Ctx, RequirePermissions } from '../../common/auth/auth.decorators.js';
import { createListQuerySchema, listFilters } from '../../common/query/list-query.js';
import { ApiErrorResponses } from '../../common/swagger/api-schemas.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod-validation.pipe.js';
import { requestMeta } from '../auth/auth.http.js';
import { DemoRestrictedGuard } from '../demo/demo-restricted.guard.js';
import type { ListUsersQuery } from './users.repository.js';
import { UsersService } from './users.service.js';

/** `GET /users` query (API §4): server tomonida qidiruv, filtr, whitelist saralash, pagination. */
const listUsersQuerySchema = createListQuerySchema({
  sortFields: ['login', 'createdAt', 'lastLoginAt'],
  defaultSort: { field: 'createdAt', direction: 'desc' },
  filters: {
    search: listFilters.search(),
    role: listFilters.oneOf(ROLE_CODES),
    status: listFilters.oneOf(USER_STATUSES),
  },
});

const idParam = () => ZodParam('id', uuidSchema);

/**
 * Users (Phase 5, API §4). O'qish — `users.read`, har qanday o'zgartirish — `users.manage` (faqat ADMIN).
 * Kim bajarayotgani `@Ctx()` dan (tasdiqlangan token + DB), hech qachon body/query'dan emas.
 * Demo saytda (`DEMO_MODE`) o'zgartirishlar yopiq: `403 DEMO_RESTRICTED`. Parol qaytaradigan javoblar keshlanmaydi (`Cache-Control: no-store`).
 */
@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(Permission.USERS_READ)
  @ApiOperation({ summary: 'Userlar ro‘yxati (qidiruv, filtr, saralash, pagination)' })
  @ApiOkResponse({ description: 'Paginated<UserDto>' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.UNAUTHENTICATED, ErrorCode.FORBIDDEN)
  list(@ZodQuery(listUsersQuerySchema) query: ListUsersQuery): Promise<Paginated<UserDto>> {
    return this.users.list(query);
  }

  // `:id` dan OLDIN e'lon qilinadi (aks holda "warehouse-options" id sifatida ushlanardi).
  @Get('warehouse-options')
  @RequirePermissions(Permission.USERS_MANAGE)
  @ApiOperation({ summary: 'User formasi uchun biriktirish mumkin bo‘lgan (ACTIVE) omborlar' })
  @ApiOkResponse({ description: 'WarehouseOption[]' })
  @ApiErrorResponses(ErrorCode.UNAUTHENTICATED, ErrorCode.FORBIDDEN)
  warehouseOptions(): Promise<WarehouseOption[]> {
    return this.users.warehouseOptions();
  }

  @Get(':id')
  @RequirePermissions(Permission.USERS_READ)
  @ApiOperation({ summary: 'User ma’lumotlari' })
  @ApiOkResponse({ description: 'UserDto' })
  @ApiErrorResponses(ErrorCode.NOT_FOUND, ErrorCode.UNAUTHENTICATED, ErrorCode.FORBIDDEN)
  get(@idParam() id: string): Promise<UserDto> {
    return this.users.get(id);
  }

  @Post()
  @RequirePermissions(Permission.USERS_MANAGE)
  @UseGuards(DemoRestrictedGuard)
  @ApiOperation({ summary: 'User yaratish (parolni server yaratadi, javobda bir marta)' })
  @ApiErrorResponses(
    ErrorCode.VALIDATION_ERROR,
    ErrorCode.LOGIN_TAKEN,
    ErrorCode.NOT_FOUND,
    ErrorCode.WAREHOUSE_INACTIVE,
    ErrorCode.FORBIDDEN,
  )
  create(
    @Ctx() ctx: AccessContext,
    @ZodBody(createUserSchema) body: CreateUserInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserCreatedResponse> {
    res.setHeader('Cache-Control', 'no-store');
    return this.users.create(ctx, body, requestMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(Permission.USERS_MANAGE)
  @UseGuards(DemoRestrictedGuard)
  @ApiOperation({ summary: 'Ism, rol va omborlarni o‘zgartirish (bitta tranzaksiya)' })
  @ApiErrorResponses(
    ErrorCode.VALIDATION_ERROR,
    ErrorCode.NOT_FOUND,
    ErrorCode.CANNOT_MODIFY_SELF,
    ErrorCode.LAST_ACTIVE_ADMIN,
    ErrorCode.WAREHOUSE_INACTIVE,
  )
  update(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @ZodBody(updateUserSchema) body: UpdateUserInput,
    @Req() req: Request,
  ): Promise<UserDto> {
    return this.users.update(ctx, id, body, requestMeta(req));
  }

  @Patch(':id/status')
  @RequirePermissions(Permission.USERS_MANAGE)
  @UseGuards(DemoRestrictedGuard)
  @ApiOperation({ summary: 'Bloklash / blokdan chiqarish (sessiyalar darhol bekor qilinadi)' })
  @ApiErrorResponses(
    ErrorCode.VALIDATION_ERROR,
    ErrorCode.NOT_FOUND,
    ErrorCode.CANNOT_MODIFY_SELF,
    ErrorCode.LAST_ACTIVE_ADMIN,
  )
  setStatus(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @ZodBody(updateUserStatusSchema) body: UpdateUserStatusInput,
    @Req() req: Request,
  ): Promise<UserDto> {
    return this.users.setStatus(ctx, id, body.status, requestMeta(req));
  }

  @Post(':id/reset-password')
  @RequirePermissions(Permission.USERS_MANAGE)
  @UseGuards(DemoRestrictedGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Parolni tiklash (yangi parol javobda bir marta, sessiyalar bekor)' })
  @ApiErrorResponses(ErrorCode.NOT_FOUND, ErrorCode.CANNOT_MODIFY_SELF, ErrorCode.FORBIDDEN)
  resetPassword(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PasswordResetResponse> {
    res.setHeader('Cache-Control', 'no-store');
    return this.users.resetPassword(ctx, id, requestMeta(req));
  }

  @Put(':id/warehouses')
  @RequirePermissions(Permission.USERS_MANAGE)
  @UseGuards(DemoRestrictedGuard)
  @ApiOperation({ summary: 'Ombor biriktirishlarini to‘liq almashtirish' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.NOT_FOUND, ErrorCode.WAREHOUSE_INACTIVE)
  replaceWarehouses(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @ZodBody(replaceUserWarehousesSchema) body: ReplaceUserWarehousesInput,
    @Req() req: Request,
  ): Promise<UserDto> {
    return this.users.replaceWarehouses(ctx, id, body.warehouseIds, requestMeta(req));
  }
}
