import { it, expect } from "vitest";
import { parseSale, promotionPreview } from "./validation";
import type { CommerceLine, Reward } from "./types";
const line: CommerceLine = {
  kind: "service",
  id: "11111111-1111-4111-8111-111111111111",
  description: "Taglio",
  quantity: 1,
  unitPriceCents: 2800,
  discountCents: 0,
};
const input = {
  requestId: line.id,
  confirmed: true,
  kind: "appointment",
  method: "cash",
  creditCents: 0,
  lines: [line],
};
const reward = {
  id: "test",
  label: "Premio",
  percent: 20,
  amount_cents: null,
  service_id: line.id,
  expires_at: null,
  used_sale_id: null,
  revoked_at: null,
  earned_appointment_id: null,
} as Reward;
it("rejects fractional money, negative credit and unconfirmed payments", () => {
  for (const change of [
    { creditCents: -1 },
    { creditCents: 0.5 },
    { confirmed: false },
    { lines: [{ ...line, unitPriceCents: 28.5 }] },
  ])
    expect(() => parseSale({ ...input, ...change })).toThrow();
});
it("rejects free lines rather than silently omitting fiscal gifts", () => {
  expect(() =>
    parseSale({ ...input, lines: [line, { ...line, discountCents: 2800 }] }),
  ).toThrow();
});
it("does not trust posted tax, identity or stock for receipt construction", () => {
  const parsed = parseSale({
    ...input,
    salonId: "spoof",
    actor: "spoof",
    lines: [{ ...line, vatPercent: 0, stock: 999 }],
  });
  expect(parsed).not.toHaveProperty("salonId");
  expect(parsed.lines[0]).not.toHaveProperty("vatPercent");
  expect(parsed.lines[0]).not.toHaveProperty("stock");
});
it("previews the promotion on one eligible service, not products", () => {
  expect(
    promotionPreview(
      [line, { ...line, kind: "product", unitPriceCents: 2000 }],
      reward,
    ),
  ).toEqual({ total: 4240, discount: 560 });
});
it("does not stack manual discounts with a reward", () =>
  expect(() =>
    promotionPreview([{ ...line, discountCents: 100 }], reward),
  ).toThrow());
it("refuses reward on a different service", () =>
  expect(() => promotionPreview([{ ...line, id: "other" }], reward)).toThrow());
it("fixed promotion never turns the service into an unsupported fiscal gift", () =>
  expect(
    promotionPreview([line], { ...reward, percent: null, amount_cents: 5000 }),
  ).toEqual({ total: 1, discount: 2799 }));
