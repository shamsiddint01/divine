import { describe, expect, it } from 'vitest';
import { assertBuildApiMode } from './build-api-mode';

// Phase 16: production image jimgina mock API bilan yig'ilmasin (SECURITY §19).
describe('assertBuildApiMode', () => {
  it('faqat aniq "http" yoki "mock" qabul qilinadi', () => {
    expect(assertBuildApiMode('http')).toBe('http');
    expect(assertBuildApiMode('mock')).toBe('mock');
  });

  it('berilmagan, bo‘sh yoki noto‘g‘ri qiymat — build to‘xtaydi', () => {
    expect(() => assertBuildApiMode(undefined)).toThrow(/VITE_API_MODE.*berilmagan/);
    expect(() => assertBuildApiMode('')).toThrow(/VITE_API_MODE/);
    expect(() => assertBuildApiMode('HTTP')).toThrow(/"HTTP"/);
  });
});
