import { VALIDATION_MESSAGES_UZ as M, customerNameSchema } from '@divine/shared';
import { describe, expect, it } from 'vitest';
import { z } from './zod';

describe('@/shared/forms/zod', () => {
  it("import qilinganda zod xabarlarini o'zbekchaga sozlaydi", () => {
    expect(z.string().min(1).safeParse('').error?.issues[0]?.message).toBe(M.required);
    expect(z.number().safeParse('x').error?.issues[0]?.message).toBe(M.mustBeNumber);
    // Shared sxemalar ham (masalan, POS mijoz maydoni) o'sha global sozlamadan foydalanadi.
    expect(customerNameSchema.safeParse(5).error?.issues[0]?.message).toBe(M.mustBeString);
  });
});
