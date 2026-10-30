-- Divine.uz — Phase 11: xarajat holati olib tashlanadi (BUSINESS-RULES D-11, D-19).
--
-- Biznes egasi qarori D-11 (2026-10-22): xarajatda "To'langan / Kutilmoqda" holati yo'q — A-27 bekor.
-- `expense_status` turini faqat shu ustun ishlatadi, shuning uchun u ham olib tashlanadi.
-- D-19 (2026-10-23): kategoriya majburiy — `category_id` NOT NULL va FK RESTRICT o'zgarmaydi.
-- Oldingi migratsiyalar qayta yozilmaydi. Summa, sana, kategoriya, izoh, muallif va soft delete
-- ustunlari (moliyaviy ma'lumot) saqlanadi; yo'qoladigan yagona qiymat — bekor qilingan holat.

ALTER TABLE "expenses" DROP COLUMN "status";

DROP TYPE "expense_status";
