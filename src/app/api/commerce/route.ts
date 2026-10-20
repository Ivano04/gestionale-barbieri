import { checkoutDay } from '@/services/checkout/day';
import { fiscalStaffAccess } from "@/services/fiscal/staff-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkoutContext, json, UUID } from "@/services/checkout/repo";
import { parseSale, commerceErrors } from "@/services/commerce/validation";
import type { CommerceLine } from "@/services/commerce/types";
async function accessCommerce() {
  const access = await fiscalStaffAccess();
  if (access.response) return access;
  const { data, error } = await access.db
    .from("users")
    .select("role")
    .eq("id", access.userId)
    .single();
  if (error || !data)
    return { response: json({ error: "Non autorizzato" }, 403) };
  return {
    ...access,
    manager: ["owner", "admin"].includes(data.role),
    canSell: ["owner", "admin", "receptionist"].includes(data.role),
  };
}
export async function GET(request: Request) {
  const access = await accessCommerce();
  if (access.response) return access.response;
  const params = new URL(request.url).searchParams;
  const aid = params.get("appointmentId");
  let cid = params.get("clientId");
  if ((aid && !UUID.test(aid)) || (cid && !UUID.test(cid)))
    return json({ error: "Identificativo non valido" }, 400);
  try {
    const db = createAdminClient(),
      salon = access.salonId;
    const appointment = aid ? await checkoutContext(aid, salon) : null;
    if (aid && !appointment)
      return json({ error: "Appuntamento non trovato" }, 404);
    if (appointment) cid = appointment.snapshotBase.clientId ?? null;
    const q = (params.get("q") ?? "").replace(/[%_(),.*\\]/g, "").slice(0, 80);
    let clientsQuery = db
      .from("clients")
      .select("id,first_name,last_name")
      .eq("salon_id", salon)
      .order("last_name")
      .limit(100);
    if (q)
      clientsQuery = clientsQuery.or(
        `first_name.ilike.%${q}%,last_name.ilike.%${q}%`,
      );
    const results = await Promise.all([
      db
        .from("commerce_settings")
        .select("products_enabled")
        .eq("salon_id", salon)
        .maybeSingle(),
      db
        .from("products")
        .select("*")
        .eq("salon_id", salon)
        .order("name")
        .limit(1000),
      db
        .from("services")
        .select("id,name,price_cents")
        .eq("salon_id", salon)
        .eq("is_active", true)
        .order("name"),
      clientsQuery,
      db
        .from("loyalty_rules")
        .select("*")
        .eq("salon_id", salon)
        .eq("active", true)
        .maybeSingle(),
      db
        .from("salon_sales")
        .select(
          "id,kind,amount_cents,credit_cents,tender_cents,payment_method,created_at,request_snapshot,snapshot,reversals:sale_reversals(document_id),documents:fiscal_documents(id,processing_status,pdf_storage_path,operation)",
        )
        .eq("salon_id", salon)
        .order("created_at", { ascending: false })
        .limit(50),
      db
        .from("stock_movements")
        .select("id,product_id,quantity,reason,created_at")
        .eq("salon_id", salon)
        .order("created_at", { ascending: false })
        .limit(50),
      db.rpc("commerce_summary", { p_salon: salon, p_actor: access.userId }),
    ]);
    if (results.some((r) => r.error)) throw new Error();
    const [settings, products, services, clients, rule, sales, stock, summary] =
      results;
    let client = null,
      balance = 0,
      movements: unknown[] = [],
      rewards: unknown[] = [],
      visits = 0;
    if (cid) {
      const rr = await Promise.all([
        db
          .from("clients")
          .select("id,first_name,last_name")
          .eq("id", cid)
          .eq("salon_id", salon)
          .maybeSingle(),
        db.rpc("commerce_balance", { p_salon: salon, p_client: cid }),
        db
          .from("customer_credit_movements")
          .select("id,kind,delta_cents,created_at")
          .eq("salon_id", salon)
          .eq("client_id", cid)
          .order("created_at", { ascending: false })
          .limit(100),
        db
          .from("customer_rewards")
          .select("*")
          .eq("salon_id", salon)
          .eq("client_id", cid)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      if (rr.some((r) => r.error)) throw new Error();
      client = rr[0].data;
      if (!client) return json({ error: "Cliente non trovato" }, 404);
      balance = rr[1].data ?? 0;
      movements = rr[2].data ?? [];
      rewards = rr[3].data ?? [];
      if (rule.data) {
        let query = db
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("salon_id", salon)
          .eq("client_id", cid)
          .eq("status", "completed")
          .gte("start_time", rule.data.created_at)
          .lte("end_time", new Date().toISOString());
        if (rule.data.service_id)
          query = query.eq("service_id", rule.data.service_id);
        const r = await query;
        if (r.error) throw new Error();
        visits = r.count ?? 0;
      }
    }
    const lines =
      appointment?.lines.map((l, i) => ({
        ...l,
        kind: "service" as const,
        id: appointment.lineIds[i],
      })) ?? [];
    const relatedAppointments = appointment?.canCollect ? await checkoutDay(salon, appointment) : [];
    return json({
      relatedAppointments,
      manager: access.manager,
      canSell: access.canSell,
      productsEnabled: settings.data?.products_enabled ?? false,
      products: products.data,
      services: services.data,
      clients: clients.data,
      rule: rule.data,
      sales: sales.data?.map(s => ({ ...s, reversals: Array.isArray(s.reversals) ? s.reversals : s.reversals ? [s.reversals] : [] })),
      stockMovements: stock.data,
      totals: summary.data,
      client,
      balance,
      movements,
      rewards,
      visits,
      appointment: appointment
        ? {
            ...appointment.appointment,
            clientId: cid,
            canCollect: appointment.canCollect,
            groupedSale: appointment.groupedSale,
            lines: lines as CommerceLine[],
            documents: appointment.documents,
            quote: appointment.quote,
          }
        : null,
    });
  } catch {
    return json(
      { error: "Impossibile caricare credito e cassa. Riprova." },
      503,
    );
  }
}
export async function POST(request: Request) {
  const access = await accessCommerce();
  if (access.response) return access.response;
  if (
    process.env.FISKALY_ENV !== "test" ||
    process.env.FISKALY_TEST_ENABLED !== "true" ||
    process.env.NEXI_ENV !== "test"
  )
    return json({ error: "Modulo disponibile solo in ambiente TEST" }, 503);
  let input: Record<string, unknown>;
  try {
    input = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error();
  } catch {
    return json({ error: "Richiesta non valida" }, 400);
  }
  try {
    const action = input.action;
    if (typeof input.requestId !== "string" || !UUID.test(input.requestId))
      return json({ error: "Identificativo richiesta non valido" }, 400);
    if (action === "sale" ? !access.canSell : !access.manager)
      return json({ error: "Operazione non autorizzata" }, 403);
    let value;
    try {
      value = action === "sale" ? parseSale(input) : input;
    } catch (e) {
      return json(
        { error: e instanceof Error ? e.message : "Dati non validi" },
        400,
      );
    }
    const { data, error } = await createAdminClient().rpc(
      action === "sale" ? "register_commerce_test" : "manage_commerce",
      { p_salon: access.salonId, p_actor: access.userId, p_input: value },
    );
    if (error) {
      const knownRollback =
        error.code === "P0001" ||
        /^(22|23)/.test(error.code ?? "") ||
        error.code === "42501";
      return json(
        {
          error: knownRollback
            ? (commerceErrors[error.message] ??
              "Operazione non completata. Verifica i campi e aggiorna i dati.")
            : "Esito non disponibile: riprendi la stessa operazione.",
        },
        knownRollback ? 409 : 503,
      );
    }
    return json({ recorded: true, id: data });
  } catch {
    return json(
      {
        error:
          "Esito non disponibile: riprendi la stessa operazione prima di crearne un’altra.",
      },
      503,
    );
  }
}
