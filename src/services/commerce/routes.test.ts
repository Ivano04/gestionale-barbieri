import { beforeEach, afterEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), role: "owner" }));
vi.mock("@/services/fiscal/staff-access", () => ({
  fiscalStaffAccess: m.access,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: m.rpc }),
}));
import { POST } from "@/app/api/commerce/route";
const salon = "11111111-1111-4111-8111-111111111111",
  actor = "22222222-2222-4222-8222-222222222222";
const body = {
  action: "sale",
  requestId: salon,
  kind: "topup",
  clientId: actor,
  confirmed: true,
  method: "cash",
  creditCents: 0,
  lines: [
    {
      kind: "topup",
      description: "Credito",
      quantity: 1,
      unitPriceCents: 20000,
      discountCents: 0,
    },
  ],
};
const request = (v: unknown) =>
  new Request("https://example.test/api/commerce", {
    method: "POST",
    body: JSON.stringify(v),
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.role = "owner";
  const q = {
    select: () => q,
    eq: () => q,
    single: async () => ({ data: { role: m.role }, error: null }),
  };
  m.access.mockResolvedValue({
    salonId: salon,
    userId: actor,
    db: { from: () => q },
  });
  m.rpc.mockResolvedValue({ data: salon, error: null });
  vi.stubEnv("FISKALY_ENV", "test");
  vi.stubEnv("FISKALY_TEST_ENABLED", "true");
  vi.stubEnv("NEXI_ENV", "test");
});
afterEach(() => vi.unstubAllEnvs());
it("authentication precedes all monetary work", async () => {
  m.access.mockResolvedValue({ response: Response.json({}, { status: 401 }) });
  expect((await POST(request(body))).status).toBe(401);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("refuses LIVE even if client claims TEST", async () => {
  vi.stubEnv("FISKALY_ENV", "live");
  expect((await POST(request(body))).status).toBe(503);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("uses authenticated salon and actor", async () => {
  expect(
    (await POST(request({ ...body, salonId: "forged", actor: "forged" })))
      .status,
  ).toBe(200);
  expect(m.rpc.mock.calls[0][1]).toMatchObject({
    p_salon: salon,
    p_actor: actor,
  });
  expect(m.rpc.mock.calls[0][1].p_input).not.toHaveProperty("actor");
});
it("receptionist may collect but cannot mint promotional rewards", async () => {
  m.role = "receptionist";
  expect((await POST(request(body))).status).toBe(200);
  expect((await POST(request({ ...body, action: "reward" }))).status).toBe(403);
});
it("stylist cannot collect money", async () => {
  m.role = "stylist";
  expect((await POST(request(body))).status).toBe(403);
});
it("malformed values never reach privileged SQL", async () => {
  expect((await POST(request({ ...body, creditCents: 2.5 }))).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("unknown network outcomes retain client replay key via a 503", async () => {
  m.rpc.mockRejectedValue(new Error("private connection detail"));
  const r = await POST(request(body));
  expect(r.status).toBe(503);
  expect(await r.text()).not.toContain("private connection");
});
it("known database rollback is reported without raw SQL", async () => {
  m.rpc.mockResolvedValue({
    error: { code: "P0001", message: "INSUFFICIENT_CREDIT" },
  });
  const r = await POST(request(body));
  expect(r.status).toBe(409);
  expect(await r.text()).toContain("Credito insufficiente");
});

it("network errors returned by Supabase also preserve the replay key", async () => {
  m.rpc.mockResolvedValue({ error: { message: "fetch failed", code: "" } });
  expect((await POST(request(body))).status).toBe(503);
});
