-- Xarajat kategoriyalari har bir user uchun alohida (biznes egasi qarori, 2026-11-03): sotuvchi faqat
-- o'zi qo'shgan kategoriyalarni ko'radi va qo'shadi. Nom endi bitta user ichida noyob (registrsiz);
-- turli userlarda bir xil nom ("Ijara") bo'lishi mumkin. Mavjud ma'lumot buzilmaydi: eski global
-- noyoblik yangisidan qat'iyroq edi.
DROP INDEX "expense_categories_name_lower_key";

CREATE UNIQUE INDEX "expense_categories_owner_name_lower_key"
  ON "expense_categories" ("created_by", lower("name"));
