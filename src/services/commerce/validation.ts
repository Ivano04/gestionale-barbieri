import { parseBasket } from "../checkout/basket";
import type { CommerceLine, Reward } from "./types";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseSale(input: Record<string, unknown>) {
  if (
    typeof input.requestId !== "string" ||
    !uuid.test(input.requestId) ||
    input.confirmed !== true ||
    !["appointment", "extra", "retail", "topup"].includes(String(input.kind)) ||
    !["cash", "card"].includes(String(input.method))
  )
    throw new Error("Conferma e dati della vendita richiesti");
  for (const key of ["appointmentId", "clientId", "rewardId", "quoteId"])
    if (
      input[key] != null &&
      (typeof input[key] !== "string" || !uuid.test(input[key] as string))
    )
      throw new Error("Identificativo non valido");
  if (
    !Number.isSafeInteger(input.creditCents) ||
    (input.creditCents as number) < 0
  )
    throw new Error("Credito non valido");
  const basket = parseBasket(input.lines);
  const source = input.lines as Record<string, unknown>[];
  const lines: CommerceLine[] = basket.lines.map((line, i) => {
    const raw = source[i];
    if (
      !["service", "product", "topup"].includes(String(raw.kind)) ||
      (raw.id != null && (typeof raw.id !== "string" || !uuid.test(raw.id)))
    )
      throw new Error("Voce non valida");
    if (line.discountCents >= line.quantity * line.unitPriceCents)
      throw new Error("Lo sconto deve essere inferiore al prezzo della voce");
    return {
      ...line,
      kind: raw.kind as CommerceLine["kind"],
      ...(raw.id ? { id: raw.id as string } : {}),
    };
  });
  if (
    input.appointmentId &&
    (typeof input.expectedUpdate !== "string" ||
      !Number.isFinite(Date.parse(input.expectedUpdate)))
  )
    throw new Error("Aggiorna i dati dell’appuntamento");
  if (input.quoteId && !Number.isSafeInteger(input.quoteVersion))
    throw new Error("Versione del preventivo non valida");
  return {
    requestId: input.requestId,
    kind: input.kind,
    method: input.method,
    confirmed: true,
    creditCents: input.creditCents,
    appointmentId: input.appointmentId ?? null,
    clientId: input.clientId ?? null,
    rewardId: input.rewardId ?? null,
    expectedUpdate: input.expectedUpdate ?? null,
    quoteId: input.quoteId ?? null,
    quoteVersion: input.quoteVersion ?? null,
    lines,
  };
}
export function promotionPreview(lines: CommerceLine[], reward?: Reward) {
  const gross = lines.reduce(
    (sum, l) => sum + l.quantity * l.unitPriceCents - l.discountCents,
    0,
  );
  if (!reward) return { total: gross, discount: 0 };
  if (lines.some((l) => l.discountCents > 0))
    throw new Error("La promozione non è cumulabile con altri sconti");
  const eligible = lines.filter(
    (l) =>
      l.kind === "service" &&
      (!reward.service_id || l.id === reward.service_id),
  );
  const base = Math.max(
    0,
    ...eligible.map((l) => l.quantity * l.unitPriceCents),
  );
  if (!base) throw new Error("La promozione richiede un servizio compatibile");
  const discount = Math.min(
    base - 1,
    reward.amount_cents ?? Math.round((base * (reward.percent ?? 0)) / 100),
  );
  if (discount <= 0) throw new Error("Sconto non applicabile");
  return { total: gross - discount, discount };
}
export const commerceErrors: Record<string, string> = {
  NOT_AUTHORIZED: "Operazione riservata al personale autorizzato.",
  INSUFFICIENT_CREDIT: "Credito insufficiente. Aggiorna il saldo.",
  INSUFFICIENT_STOCK: "Quantità in magazzino insufficiente.",
  PRODUCTS_DISABLED: "La vendita prodotti è disattivata.",
  PRICE_CHANGED: "Il prezzo è cambiato. Ricarica la cassa.",
  ALREADY_PAID:
    "Il servizio è già pagato. Usa una vendita aggiuntiva per i prodotti.",
  STALE_APPOINTMENT: "Appuntamento modificato. Ricarica la cassa.",
  REWARD_UNAVAILABLE:
    "Promozione già usata, scaduta o non ancora utilizzabile.",
  REWARD_NOT_STACKABLE: "La promozione non è cumulabile con altri sconti.",
  REWARD_SERVICE_MISMATCH: "La promozione richiede un servizio compatibile.",
  STALE_QUOTE: "Preventivo modificato o non più valido.",
  CONFLICTING_REQUEST: "Questa richiesta è già stata usata con dati diversi.",
  CREDIT_VAT_MISMATCH:
    "Il credito TEST è utilizzabile solo per voci con IVA al 22%.",
  TEST_CONFIG_REQUIRED: "Configurazione fiscale TEST non disponibile.",
  FISCAL_NOT_READY: "Attendi l’emissione del documento prima di annullare.",
  RETURN_REQUIRES_REVIEW:
    "L’annullo automatico TEST è disponibile nella giornata della vendita. Per un reso successivo serve una verifica fiscale.",
  CREDIT_ALREADY_SPENT:
    "La ricarica è già stata utilizzata: saldo insufficiente per annullarla.",
  ALREADY_REVERSED: "Questa vendita è già stata annullata.",
  SALE_NOT_REVERSIBLE: "Questa vendita richiede una verifica manuale.",
  APPOINTMENT_CLOSED: "Appuntamento annullato o non incassabile.",
};
