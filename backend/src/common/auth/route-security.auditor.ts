import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { SECURITY_METADATA_KEYS } from './auth.decorators.js';

/**
 * "Himoyasiz endpoint qolmasin" (RBAC §4.1, §7): ishga tushishda barcha controller handler'lari
 * tekshiriladi. `@Public`, `@Authenticated`, `@RequirePermissions` yoki `@RequireAnyPermission`
 * belgilanmagan endpoint topilsa — ilova ishga TUSHMAYDI (xato ro'yxati bilan).
 */
@Injectable()
export class RouteSecurityAuditor implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const unprotected = this.findUnprotectedRoutes();
    if (unprotected.length > 0) {
      throw new Error(
        `Xavfsizlik decorator'i yo'q endpointlar (deny by default, RBAC §4.1):\n  - ${unprotected.join('\n  - ')}`,
      );
    }
  }

  /** `Controller.method` ro'yxati (testlar uchun ham). */
  findUnprotectedRoutes(): string[] {
    const result: string[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const instance = wrapper.instance as object | undefined;
      const controller = wrapper.metatype as
        (abstract new (...args: never[]) => unknown) | undefined;
      if (!instance || !controller) continue;
      const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
      for (const name of this.scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name] as (...args: unknown[]) => unknown;
        if (this.reflector.get(PATH_METADATA, handler) === undefined) continue;
        const secured = SECURITY_METADATA_KEYS.some(
          (key) => this.reflector.getAllAndOverride(key, [handler, controller]) !== undefined,
        );
        if (!secured) result.push(`${controller.name}.${name}`);
      }
    }
    return result;
  }
}
