import { Permission } from '@divine/shared';
import { Barcode, Pencil } from 'lucide-react';
import { Link } from 'react-router';
import { useHasAnyPermission } from '@/features/session/hooks/use-permissions';
import { t } from '@/i18n/uz';
import { lineTotal, percent, subMoney } from '@/shared/lib/decimal';
import { formatDate, formatDateTime, formatMoney } from '@/shared/lib/format';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { MoneyText, QtyText } from '@/shared/components/MoneyText';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Separator } from '@/shared/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/ui/sheet';
import { Skeleton } from '@/shared/ui/skeleton';
import type { ProductDto } from '@/shared/types/api';
import { useProduct, useProductSummary } from '../api/products';

interface ProductDetailSheetProps {
  productId: string | null;
  onOpenChange: (open: boolean) => void;
  onEdit: (product: ProductDto) => void;
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 text-base font-semibold">{children}</div>
    </div>
  );
}

/**
 * Mahsulot detali (REQ-053): jami kelgan, jami sotilgan, joriy qoldiq, sotuv tarixi.
 * Moliyaviy qism (kelgan narxi, foyda, tushum, sotuvlar) — faqat `products.read_cost` bilan
 * (`/summary`); boshqalar uchun oddiy `GET /products/:id` (backend kelgan narxini umuman bermaydi).
 */
export function ProductDetailSheet({ productId, onOpenChange, onEdit }: ProductDetailSheetProps) {
  const canReadCost = useHasAnyPermission([Permission.PRODUCTS_READ_COST]);
  const canManage = useHasAnyPermission([Permission.PRODUCTS_MANAGE]);
  // To'liq sotuv tarixi — sotuvlar tarixi mahsulot filtri bilan (REQ-053, GET /sales?productId=).
  const canReadAllSales = useHasAnyPermission([Permission.SALES_READ_ALL]);
  const summary = useProductSummary(canReadCost ? productId : null);
  const basic = useProduct(canReadCost ? null : productId);
  const { data } = summary;
  const { isPending, error, refetch } = canReadCost ? summary : basic;
  const p = canReadCost ? data?.product : basic.data;
  const profitPerUnit = p?.costPrice ? subMoney(p.salePrice, p.costPrice) : null;
  const margin = p?.costPrice && profitPerUnit ? percent(profitPerUnit, p.costPrice) : null;

  return (
    <Sheet open={Boolean(productId)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{p?.name ?? t.products.detail.title}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            {p ? (
              <>
                <StatusBadge status={p.status} />
                <Badge variant="outline">{p.groupName}</Badge>
                {p.barcode ? (
                  <span className="inline-flex items-center gap-1 font-mono text-xs">
                    <Barcode className="size-3.5" />
                    {p.barcode}
                  </span>
                ) : null}
              </>
            ) : null}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {error ? (
            <ErrorState message={error.message} onRetry={() => refetch()} />
          ) : isPending || !p ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t.products.detail.basicInfo}</h3>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 rounded-lg border p-4 text-sm">
                  <dt className="text-muted-foreground">{t.products.col.barcode}</dt>
                  <dd className="text-right font-mono text-xs">{p.barcode ?? t.common.notSet}</dd>
                  <dt className="text-muted-foreground">{t.products.col.group}</dt>
                  <dd className="text-right">{p.groupName}</dd>
                  <dt className="text-muted-foreground">{t.products.form.unit}</dt>
                  <dd className="text-right">{t.unitNames[p.unit]}</dd>
                  <dt className="text-muted-foreground">{t.products.col.warehouse}</dt>
                  <dd className="text-right">
                    {p.warehouses.length
                      ? p.warehouses.map((w) => w.warehouseName).join(', ')
                      : t.products.noWarehouse}
                  </dd>
                  <dt className="text-muted-foreground">{t.products.form.minStock}</dt>
                  <dd className="text-right">
                    {p.minStock ? <QtyText value={p.minStock} unit={p.unit} /> : t.common.notSet}
                  </dd>
                  <dt className="text-muted-foreground">{t.products.col.status}</dt>
                  <dd className="text-right">
                    <StatusBadge status={p.status} />
                  </dd>
                </dl>
              </section>

              <div className="grid grid-cols-3 gap-3">
                <Metric label={t.products.detail.totalReceived}>
                  <QtyText value={p.received} unit={p.unit} />
                </Metric>
                <Metric label={t.products.detail.totalSold}>
                  <QtyText value={p.sold} unit={p.unit} />
                </Metric>
                <Metric label={t.products.detail.currentStock}>
                  <QtyText
                    value={p.stock}
                    unit={p.unit}
                    className={p.isLowStock ? 'text-warning' : undefined}
                  />
                </Metric>
              </div>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t.products.detail.prices}</h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border p-4 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{t.products.col.salePrice}</span>
                    <MoneyText value={p.salePrice} className="font-medium" />
                  </div>
                  {data ? (
                    <>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{t.products.col.costPrice}</span>
                        <MoneyText value={p.costPrice} />
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">
                          {t.products.detail.profitPerUnit}
                        </span>
                        <MoneyText value={profitPerUnit} className="text-success" />
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{t.products.detail.margin}</span>
                        <span className="tabular-nums">
                          {margin ? `${margin.replace('.', ',')}%` : t.common.notSet}
                        </span>
                      </div>
                      <Separator className="col-span-2" />
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{t.reports.kpi.revenue}</span>
                        <MoneyText value={data.totalRevenue} />
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{t.reports.kpi.profit}</span>
                        <MoneyText value={data.grossProfit} className="text-success" />
                      </div>
                    </>
                  ) : null}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t.products.detail.byWarehouse}</h3>
                {p.warehouses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.products.noWarehouse}</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {p.warehouses.map((w) => (
                      <li
                        key={w.warehouseId}
                        className="flex items-center justify-between px-3 py-2 text-sm"
                      >
                        <span>{w.warehouseName}</span>
                        <span className="flex items-center gap-3">
                          <QtyText value={w.quantity} unit={p.unit} className="font-medium" />
                          {p.costPrice ? (
                            <span className="w-28 text-right text-xs text-muted-foreground tabular-nums">
                              {formatMoney(lineTotal(w.quantity, p.costPrice))}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {data ? (
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">{t.products.detail.recentSales}</h3>
                    {canReadAllSales && data.recentSales.length > 0 ? (
                      <Link
                        to={`/sales?tab=history&productId=${p.id}`}
                        className="text-xs text-primary hover:underline"
                      >
                        {t.products.detail.allSales}
                      </Link>
                    ) : null}
                  </div>
                  {data.recentSales.length === 0 ? (
                    <EmptyState title={t.products.detail.noSales} />
                  ) : (
                    <ul className="divide-y rounded-lg border">
                      {data.recentSales.map((s) => (
                        <li
                          key={`${s.saleId}-${s.quantity}`}
                          className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium">{s.customerName}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {s.saleNumber} · {formatDateTime(s.soldAt)} · {s.warehouseName}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <MoneyText value={s.lineTotal} className="font-medium" />
                            <p className="text-xs text-muted-foreground">
                              <QtyText value={s.quantity} unit={p.unit} />
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {t.products.detail.createdAt}: {formatDate(p.createdAt)}
              </p>
            </>
          )}
        </div>
        {p && canManage ? (
          <SheetFooter>
            <Button onClick={() => onEdit(p)}>
              <Pencil />
              {t.common.edit}
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
