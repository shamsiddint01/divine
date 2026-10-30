import { describe, expect, it } from 'vitest';
import {
  addQty,
  compareMoney,
  compareQty,
  divideMoney,
  fromUnits,
  lineTotal,
  normalizeNumberInput,
  percent,
  subMoney,
  subQty,
  sumMoney,
  sumQty,
  toChartNumber,
  toUnits,
} from './decimal';

describe('decimal (BigInt fixed-point)', () => {
  it('string ↔ units', () => {
    expect(toUnits('12.5', 2)).toBe(1250n);
    expect(toUnits('-0.01', 2)).toBe(-1n);
    expect(toUnits('abc', 2)).toBeNull();
    expect(fromUnits(1250n, 2)).toBe('12.50');
    expect(fromUnits(-5n, 3)).toBe('-0.005');
  });

  it('float xatosisiz qo‘shadi', () => {
    expect(sumMoney(['0.1', '0.2'])).toBe('0.30');
    expect(sumMoney(['9999999999999999.99', '0.01'])).toBe('10000000000000000.00');
  });

  it('kirim misoli: 50 + 30 + 100 + 20 = 200', () => {
    expect(sumQty(['50', '30', '100', '20'])).toBe('200.000');
  });

  it('qator summasi round(q × p, 2)', () => {
    expect(lineTotal('3', '2150000')).toBe('6450000.00');
    expect(lineTotal('1.255', '10000.00')).toBe('12550.00');
    expect(lineTotal('0.333', '0.05')).toBe('0.02'); // 0.01665 → 0.02
  });

  it('taqqoslash va foiz', () => {
    expect(compareQty('2', '2.000')).toBe(0);
    expect(compareQty('2.001', '2')).toBe(1);
    expect(percent('25', '200')).toBe('12.5');
    expect(percent('1', '0')).toBeNull();
  });

  it('foydalanuvchi kiritgan sonni normallashtiradi', () => {
    expect(normalizeNumberInput('1 250 000,50')).toBe('1250000.50');
    expect(normalizeNumberInput('12.')).toBe('12');
    expect(normalizeNumberInput('-5')).toBeNull();
    expect(normalizeNumberInput('abc')).toBeNull();
  });
});

describe('decimal — chegara holatlari (Phase 15)', () => {
  it('ortiqcha kasr xonalari yarim yuqoriga yaxlitlanadi; manfiy qiymatlar; noto‘g‘ri kirish', () => {
    expect(toUnits('1.005', 2)).toBe(101n);
    expect(toUnits('1.004', 2)).toBe(100n);
    expect(toUnits('-1.005', 2)).toBe(-101n);
    expect(toUnits('-3', 2)).toBe(-300n);
    expect(toUnits('1e3', 2)).toBeNull();
    expect(fromUnits(-150n, 2)).toBe('-1.50');
    expect(fromUnits(7n, 0)).toBe('7');
  });

  it('ayirish, qo‘shish, pul taqqoslash, foiz va o‘rtacha chek', () => {
    expect(subMoney('10', '0.01')).toBe('9.99');
    expect(subQty('1', '0.25')).toBe('0.750');
    expect(addQty('0.1', '0.2')).toBe('0.300');
    expect([compareMoney('1', '2'), compareMoney('2', '2'), compareMoney('3', '2')]).toEqual([
      -1, 0, 1,
    ]);
    expect(percent('1', '0')).toBeNull();
    expect(percent('-1', '3')).toBe('-33.3');
    expect(divideMoney('100', 3)).toBe('33.33');
    expect(divideMoney('-100', 3)).toBe('-33.33');
    expect(divideMoney('100', 0)).toBe('0.00');
    expect(divideMoney('100', 1.5)).toBe('0.00');
    expect(lineTotal('0.333', '1.50')).toBe('0.50');
    expect(toChartNumber('12.50')).toBe(12.5);
    expect(normalizeNumberInput('12.')).toBe('12');
    expect(normalizeNumberInput('-5')).toBeNull();
  });
});
