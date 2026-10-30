import { type INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import {
  hasAllPermissions,
  hasAnyPermission,
  type Permission,
  ROLE_PERMISSIONS,
  type RoleCode,
} from '@divine/shared';
import {
  AUTHENTICATED_KEY,
  PERMISSIONS_ALL_KEY,
  PERMISSIONS_ANY_KEY,
  PUBLIC_KEY,
} from '../../../src/common/auth/auth.decorators.js';

/*
 * Ishlayotgan ilovadagi barcha HTTP endpointlar va ularning xavfsizlik decorator'lari — Nest
 * metadata'sidan (qo'lda ro'yxat emas). RBAC matritsasi (AC-18) va Phase 16 xavfsizlik testlari
 * (fuzz, maxfiy maydonlar skaneri) shu ro'yxat bilan ishlaydi: yangi endpoint avtomatik qamraladi.
 */
/** Test yordamchi modullari (`__rbac`, `__probe`) matritsaga kirmaydi. */
const TEST_ONLY = /^\/__/;

export type Security =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'all' | 'any'; permissions: readonly Permission[] };

export interface RouteInfo {
  key: string;
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  security: Security;
}

export function discoverRoutes(app: INestApplication): RouteInfo[] {
  const discovery = app.get(DiscoveryService);
  const reflector = app.get(Reflector);
  const scanner = new MetadataScanner();
  const routes: RouteInfo[] = [];
  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype as (abstract new (...args: never[]) => unknown) | undefined;
    const instance = wrapper.instance as object | undefined;
    if (!controller || !instance) continue;
    const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const name of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[name] as (...args: unknown[]) => unknown;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (path === undefined || method === undefined) continue;
      const full = `/${[base, path].filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/');
      if (TEST_ONLY.test(full)) continue;
      const meta = <T>(key: string) => reflector.getAllAndOverride<T>(key, [handler, controller]);
      const all = meta<Permission[]>(PERMISSIONS_ALL_KEY);
      const any = meta<Permission[]>(PERMISSIONS_ANY_KEY);
      const security: Security = meta<boolean>(PUBLIC_KEY)
        ? { kind: 'public' }
        : all
          ? { kind: 'all', permissions: all }
          : any
            ? { kind: 'any', permissions: any }
            : meta<boolean>(AUTHENTICATED_KEY)
              ? { kind: 'authenticated' }
              : (() => {
                  throw new Error(`xavfsizlik decorator'i yo'q: ${full}`);
                })();
      const verb = RequestMethod[method];
      routes.push({
        key: `${verb} ${full}`,
        method: verb.toLowerCase() as RouteInfo['method'],
        path: full,
        security,
      });
    }
  }
  return routes.sort((a, b) => a.key.localeCompare(b.key));
}

export function allowed(role: RoleCode, security: Security): boolean {
  const granted = ROLE_PERMISSIONS[role];
  switch (security.kind) {
    case 'public':
    case 'authenticated':
      return true;
    case 'all':
      return hasAllPermissions(granted, security.permissions);
    case 'any':
      return hasAnyPermission(granted, security.permissions);
  }
}
