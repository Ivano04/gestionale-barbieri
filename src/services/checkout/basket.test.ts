import { describe,it,expect } from 'vitest';
import { parseBasket,euroInput,buildSalonReceipt } from './basket';
const line={description:'Taglio',quantity:2,unitPriceCents:2440,discountCents:100};
describe('salon basket',()=>{
 it('uses integer cents and line discounts',()=>{expect(euroInput('12,34')).toBe(1234);expect(parseBasket([line]).amountCents).toBe(4780);expect(()=>euroInput('1.234')).toThrow();});
 it('rejects invalid quantities, hidden precision, excessive discounts and totals',()=>{for(const bad of [{...line,quantity:1.2},{...line,unitPriceCents:1.2},{...line,discountCents:99999},{...line,quantity:-1},{...line,description:'\n'},{...line,quantity:99,unitPriceCents:1000000}])expect(()=>parseBasket([bad])).toThrow();expect(()=>parseBasket([])).toThrow();});
 it('normalizes JSONB key order before comparing saved lines',()=>{const other={discountCents:100,unitPriceCents:2440,quantity:2,description:'Taglio'};expect(JSON.stringify(parseBasket([line]).lines)).toBe(JSON.stringify(parseBasket([other]).lines));});
 it('builds multiple fiscal rows with consistent VAT totals and cash payment',()=>{
  const b=parseBasket([line,{description:'Piega',quantity:1,unitPriceCents:1220,discountCents:0}]);const r=buildSalonReceipt(b,'TEST-123456789ABCDEF',22,'cash');
  expect(r.entries).toHaveLength(2);expect(r.payments[0].type).toBe('CASH');expect(r.totals.vat.inclusive).toBe('60.00');
  expect(r.entries.reduce((sum,e)=>sum+Math.round(Number(e.data.vat.amount)*100),0)).toBe(Math.round(Number(r.totals.vat.amount)*100));
  expect(r.entries[0].data.text).toContain('2 x Taglio');expect(r.entries[0].data.text).toContain('sconto');
 });
 it('records an external card without requesting any card data or calling Nexi',()=>{const r=buildSalonReceipt(parseBasket([line]),'TEST-123456789ABCDEF',22,'card');expect(r.payments[0]).toMatchObject({type:'CARD',number:'****'});expect(()=>buildSalonReceipt(parseBasket([line]),'INVALID',22,'cash')).toThrow();});
});
