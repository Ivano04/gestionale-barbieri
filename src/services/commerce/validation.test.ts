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

const ap1 = "11111111-1111-4111-8111-111111111111";
const ap2 = "22222222-2222-4222-8222-222222222222";
const stamp = "2026-10-20T10:00:00Z";
const group = { ...input, appointmentId: ap1, clientId: ap2, expectedUpdate: stamp,
  appointments: [{ id: ap1, expectedUpdate: stamp }, { id: ap2, expectedUpdate: stamp }],
  lines: [{ ...line, appointmentId: ap1 }, { ...line, appointmentId: ap2 }] };
it("keeps each service linked and canonicalizes grouped selection for retries", () => {
  expect(parseSale({ ...group, appointments: [...group.appointments].reverse() })).toEqual(parseSale(group));
  expect(parseSale(group).lines.map(l => l.appointmentId)).toEqual([ap1, ap2]);
});
it("rejects missing, duplicate or unrepresented appointments", () => {
  for (const change of [
    { appointments: [group.appointments[0], group.appointments[0]] },
    { lines: [group.lines[0]] },
    { lines: [line, group.lines[1]] },
    { clientId: null }, { kind: "retail" }, { quoteId: ap1, quoteVersion: 1 },
    { appointments: [{ id: ap1, expectedUpdate: "bad" }, group.appointments[1]] },
  ]) expect(() => parseSale({ ...group, ...change })).toThrow();
});
it("preserves legacy single-sale replay representation", () => {
  const parsed = parseSale({ ...input, lines: [{ ...line, appointmentId: ap1 }] });
  expect(parsed).not.toHaveProperty("appointments");
  expect(parsed.lines[0]).not.toHaveProperty("appointmentId");
});
