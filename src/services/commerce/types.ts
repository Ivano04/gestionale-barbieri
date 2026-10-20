export type CommerceLine = {
  kind: "service" | "product" | "topup";
  id?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  vatPercent?: number;
  appointmentId?: string;
};
export type Reward = {
  id: string;
  label: string;
  percent: number | null;
  amount_cents: number | null;
  service_id: string | null;
  expires_at: string | null;
  used_sale_id: string | null;
  revoked_at: string | null;
  earned_appointment_id: string | null;
};
export type Product = {
  id: string;
  name: string;
  sku: string;
  price_cents: number;
  vat_percent: number;
  stock: number;
  minimum_stock: number;
  active: boolean;
};
export type CommerceSale = {
  id: string;
  kind: string;
  amount_cents: number;
  credit_cents: number;
  tender_cents: number;
  payment_method: string;
  created_at: string;
  request_snapshot: unknown;
  snapshot: { clientName: string; lines: CommerceLine[] };
  reversals: { document_id: string }[];
  documents: {
    id: string;
    processing_status: string;
    pdf_storage_path?: string | null;
    operation: string;
  }[];
};
export type CheckoutAppointment = {
  id: string;
  updatedAt: string;
  startTime: string;
  serviceName: string;
  stylistName: string;
  canCollect: boolean;
  reason: string | null;
  hasQuote: boolean;
  lines: CommerceLine[];
};
export type CommerceData = {
  relatedAppointments: CheckoutAppointment[];
  manager: boolean;
  canSell: boolean;
  productsEnabled: boolean;
  products: Product[];
  services: { id: string; name: string; price_cents: number }[];
  clients: { id: string; first_name: string; last_name: string }[];
  client: { id: string; first_name: string; last_name: string } | null;
  balance: number;
  movements: {
    id: string;
    kind: string;
    delta_cents: number;
    created_at: string;
  }[];
  rewards: Reward[];
  sales: CommerceSale[];
  stockMovements: {
    id: string;
    product_id: string;
    quantity: number;
    reason: string;
    created_at: string;
  }[];
  rule: {
    id: string;
    name: string;
    visits: number;
    percent: number;
    service_id: string | null;
    created_at: string;
  } | null;
  visits: number;
  totals: {
    creditOutstanding: number;
    cashReceived: number;
    creditUsed: number;
  };
  appointment: {
    id: string;
    status: string;
    updatedAt: string;
    clientId: string | null;
    clientName: string;
    canCollect: boolean;
    groupedSale?: { id: string; amountCents: number; appointmentIds: string[] } | null;
    lines: CommerceLine[];
    documents: {
      id: string;
      processing_status: string;
      pdf_available: boolean;
      operation: string;
      amount_cents: number;
    }[];
    quote: {
      id: string;
      version: number;
      snapshot: { lines: CommerceLine[] };
      status: string;
    } | null;
  } | null;
};
