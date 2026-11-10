import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { buildXlsx } from './xlsx';
it('gen', () => { writeFileSync('/tmp/claude-1000/-home-shamsiddin-Desktop-divine-uz/a732f585-5fc0-4b50-93d2-4da1afb960fa/scratchpad/t.xlsx', buildXlsx([{name:'To‘lovlar',rows:[['Sayt','Summa'],['Do‘kon & <1>',500000.5]]},{name:'Saytlar',rows:[['A'],['B']]}])); });
