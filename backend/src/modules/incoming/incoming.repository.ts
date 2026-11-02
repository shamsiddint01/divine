import { Injectable } from '@nestjs/common';
import type { ProductStatus } from '@divine/shared';
import type { Tx } from '../../infrastructure/prisma/transaction-runner.js';

export interface ProductForIncoming {
  id: string;
  name: string;
  barcode: string | null;
  status: ProductStatus;
  allowDecimal: boolean;
}

export interface NewItem {
  productId: string;
  productName: string;
  barcode: string | null;
  quantity: string;
  costPrice: string;
}

/** Tasdiqlangan hujjatning server hisoblagan ko'rsatkichlari (audit uchun). */
export interface ConfirmedTotals {
  number: string;
  totalQuantity: string;
  totalAmount: string;
}

/**
 * Kirim hujjatlari — data access (DATABASE §4.9–4.10). Hujjatlar faqat "qoldiq qo'shish" orqali
 * yoziladi va darhol tasdiqlanadi; totallar DB'dagi qatorlardan hisoblanadi (`line_total` GENERATED,
 * REQ-063/065). Holat o'tishlari va qator o'zgarishlarini trigger'lar ham himoyalaydi (`incoming_guard`).
 */
@Injectable()
export class IncomingRepository {
  /**
   * Mahsulotlar `FOR SHARE` bilan: yozish davomida mahsulot nofaol qilinmaydi va butun/kasr siyosati
   * o'zgarmaydi. ID tartibida — deadlock yo'q.
   */
  async lockProducts(tx: Tx, ids: string[]): Promise<Map<string, ProductForIncoming>> {
    const rows = await tx.$queryRaw<ProductForIncoming[]>`
      SELECT id, name, barcode, status::text AS status, allow_decimal AS "allowDecimal"
        FROM products WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR SHARE`;
    return new Map(rows.map((row) => [row.id, row]));
  }

  async create(
    tx: Tx,
    data: { date: string; warehouseId: string; notes: string | null; createdById: string },
  ): Promise<string> {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO incoming (incoming_date, warehouse_id, notes, created_by)
      VALUES (${data.date}::date, ${data.warehouseId}::uuid, ${data.notes}, ${data.createdById}::uuid)
      RETURNING id`;
    if (!row) throw new Error('incoming INSERT qator qaytarmadi');
    return row.id;
  }

  /** Qatorlar (snapshot'lar shu paytdagi mahsulot ma'lumotidan, D-08); ledger uchun ID'lar qaytadi. */
  async insertItems(
    tx: Tx,
    id: string,
    items: NewItem[],
  ): Promise<{ id: string; productId: string }[]> {
    return tx.incomingItem.createManyAndReturn({
      data: items.map((item) => ({ incomingId: id, ...item })),
      select: { id: true, productId: true },
    });
  }

  /**
   * DRAFT → CONFIRMED (shartli UPDATE, BR-17). Totallar shu UPDATE'ning o'zida qatorlardan
   * hisoblanadi — `incoming_guard` ularni yana tekshiradi. `null` — hujjat DRAFT emas edi.
   */
  async markConfirmed(
    tx: Tx,
    id: string,
    actorId: string,
    at: Date,
  ): Promise<ConfirmedTotals | null> {
    const rows = await tx.$queryRaw<ConfirmedTotals[]>`
      UPDATE incoming d SET
        status = 'CONFIRMED', confirmed_by = ${actorId}::uuid, confirmed_at = ${at},
        total_quantity = t.qty, total_amount = t.amount, updated_at = now()
        FROM (SELECT coalesce(sum(quantity), 0) AS qty, coalesce(sum(line_total), 0) AS amount
                FROM incoming_items WHERE incoming_id = ${id}::uuid) t
       WHERE d.id = ${id}::uuid AND d.status = 'DRAFT'
       RETURNING 'K-' || lpad(d.number::text, 6, '0') AS number,
                 d.total_quantity::text AS "totalQuantity", d.total_amount::text AS "totalAmount"`;
    return rows[0] ?? null;
  }
}
