import { t } from '@/i18n/uz';
import { MoneyText, QtyText } from '@/shared/components/MoneyText';
import { formatDate, formatDateTime } from '@/shared/lib/format';
import { Card, CardContent } from '@/shared/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/ui/table';
import type { IncomingDto } from '@/shared/types/api';

/** Tasdiqlangan yoki bekor qilingan kirim — faqat ko'rish. */
export function IncomingReadOnly({ doc }: { doc: IncomingDto }) {
  return (
    <div className="space-y-4">
      <Card className="gap-4">
        <CardContent className="grid gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">{t.incoming.form.date}</p>
            <p className="font-medium">{formatDate(doc.date)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t.incoming.form.warehouse}</p>
            <p className="font-medium">{doc.warehouseName}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t.incoming.col.createdBy}</p>
            <p className="font-medium">{doc.createdBy.fullName ?? doc.createdBy.login}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t.incoming.form.confirmedBy}</p>
            <p className="font-medium">
              {doc.confirmedBy
                ? `${doc.confirmedBy.fullName ?? doc.confirmedBy.login} · ${formatDateTime(doc.confirmedAt ?? '')}`
                : t.common.notSet}
            </p>
          </div>
          {doc.notes ? (
            <p className="rounded-md bg-muted/50 p-3 sm:col-span-4">{doc.notes}</p>
          ) : null}
        </CardContent>
      </Card>
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.incoming.form.product}</TableHead>
              <TableHead className="hidden md:table-cell">{t.incoming.form.group}</TableHead>
              <TableHead className="hidden lg:table-cell">{t.incoming.form.barcode}</TableHead>
              <TableHead className="text-right">{t.incoming.form.quantity}</TableHead>
              <TableHead className="hidden text-right sm:table-cell">
                {t.incoming.form.costPrice}
              </TableHead>
              <TableHead className="text-right">{t.incoming.form.lineTotal}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {doc.items?.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-medium max-sm:min-w-20 max-sm:whitespace-normal">
                  {i.productName}
                  {/* Telefonda kelgan narxi shu yerda (alohida ustun sig'maydi) */}
                  <p className="text-xs font-normal text-muted-foreground sm:hidden">
                    {t.incoming.form.costPrice}: <MoneyText value={i.costPrice} />
                  </p>
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {i.groupName}
                </TableCell>
                <TableCell className="hidden font-mono text-xs lg:table-cell">
                  {i.barcode ?? t.common.notSet}
                </TableCell>
                <TableCell className="text-right">
                  <QtyText value={i.quantity} unit={i.unit} />
                </TableCell>
                <TableCell className="hidden text-right sm:table-cell">
                  <MoneyText value={i.costPrice} muted />
                </TableCell>
                <TableCell className="text-right">
                  <MoneyText value={i.lineTotal} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              {/* colSpan o'rniga ustunlar bilan bir xil yashirinadigan bo'sh kataklar — har kenglikda tekis */}
              <TableCell className="font-semibold max-sm:whitespace-normal">
                {t.incoming.form.totalQuantity}
              </TableCell>
              <TableCell className="hidden md:table-cell" />
              <TableCell className="hidden lg:table-cell" />
              <TableCell className="text-right font-semibold">
                <QtyText value={doc.totalQuantity} />
              </TableCell>
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="text-right font-semibold">
                <MoneyText value={doc.totalAmount} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
