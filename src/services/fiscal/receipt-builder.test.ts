import { describe, it, expect } from 'vitest';
import { buildTestReceipt } from './receipt-builder';
describe('receipt TEST snapshot',()=>{
 it('fotografa importi interi e pagamento carta',()=>{
  const r=buildTestReceipt(2440,'Taglio TEST','TEST-1',22);
  expect(r.totals.vat).toEqual({amount:'4.40',exclusive:'20.00',inclusive:'24.40'});
  expect(r.payments[0].type).toBe('CARD');
 });
 it('rifiuta numeri documento lunghi o con lettere minuscole',()=>{
  expect(()=>buildTestReceipt(2440,'x','TEST-'+ 'A'.repeat(16),22)).toThrow();
  expect(()=>buildTestReceipt(2440,'x','test-1',22)).toThrow();
  expect(buildTestReceipt(2440,'x','TEST-'+ 'A'.repeat(15),22).document.number).toHaveLength(20);
 });
 it('rifiuta importi e aliquote non validi',()=>{
  expect(()=>buildTestReceipt(24.4,'x','1',22)).toThrow();
  expect(()=>buildTestReceipt(2440,'x','1',NaN)).toThrow();
 });
});
