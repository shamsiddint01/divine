import type { ComponentProps } from 'react';
import { cn } from '@/shared/lib/utils';

// shadcn/ui Skeleton — loading holati uchun
function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-accent', className)}
      {...props}
    />
  );
}

export { Skeleton };
