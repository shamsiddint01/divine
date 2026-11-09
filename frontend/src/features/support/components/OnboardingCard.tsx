import type { DashboardSummaryDto } from '@divine/shared';
import { CircleCheck, Circle, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useWarehouses } from '@/features/warehouses/api/warehouses';
import { t } from '@/i18n/uz';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

const KEY = 'divine.onboarding-hidden';

const hidden = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

/** Yangi mijozga birinchi qadamlar: ombor → mahsulot → sotuv. Hammasi bajarilsa o'zi yo'qoladi. */
export function OnboardingCard({ summary }: { summary: DashboardSummaryDto | undefined }) {
  const [closed, setClosed] = useState(hidden);
  const { data: warehouses } = useWarehouses();
  if (closed || !summary || !warehouses) return null;
  const steps = [
    { done: warehouses.length > 0, label: t.support.stepWarehouse, to: '/warehouses' },
    {
      done: summary.warehouse.productCount > 0,
      label: t.support.stepProduct,
      to: '/products',
    },
    { done: summary.allTime.salesCount > 0, label: t.support.stepSale, to: '/sales' },
  ];
  if (steps.every((step) => step.done)) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // Saqlash o'chiq: keyingi safar yana ko'rinadi.
    }
    setClosed(true);
  };
  return (
    <Card className="gap-3 border-primary/30">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t.support.onboardingTitle}</CardTitle>
        <Button variant="ghost" size="icon" aria-label={t.support.close} onClick={close}>
          <X />
        </Button>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-2 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.to}>
              <Link
                to={step.to}
                className="flex items-center gap-2 rounded-lg border p-3 text-sm hover:border-primary/50"
              >
                {step.done ? (
                  <CircleCheck className="size-5 shrink-0 text-emerald-500" />
                ) : (
                  <Circle className="size-5 shrink-0 text-muted-foreground" />
                )}
                <span className={step.done ? 'text-muted-foreground line-through' : 'font-medium'}>
                  {index + 1}. {step.label}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
