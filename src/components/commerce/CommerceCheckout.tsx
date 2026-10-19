"use client";
import { useEffect, useRef, useState } from "react";
import type { CommerceLine, Reward } from "@/services/commerce/types";
import { euroInput, parseBasket } from "@/services/checkout/basket";
import { promotionPreview } from "@/services/commerce/validation";
import {
  button,
  CommandNotice,
  field,
  Modal,
  money,
  useCommerce,
  useCommerceCommand,
} from "./shared";
type Props = {
  appointmentId?: string;
  clientId?: string;
  kind?: "retail" | "topup";
  quoteId?: string;
  onClose: () => void;
};
export function CommerceCheckout({
  appointmentId,
  clientId,
  kind = "retail",
  quoteId: initialQuoteId,
  onClose,
}: Props) {
  const editor = useRef<HTMLDivElement>(null);
  const [inputError, setInputError] = useState("");
  const [quoteId, setQuoteId] = useState(initialQuoteId);
  const [now] = useState(() => Date.now());
  const query = appointmentId
    ? "?appointmentId=" + appointmentId
    : clientId
      ? "?clientId=" + clientId
      : "";
  const { data, error, load } = useCommerce(query);
  const [lines, setLines] = useState<CommerceLine[]>([]),
    [ready, setReady] = useState(false),
    [review, setReview] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [done, setDone] = useState(false);
  const [credit, setCredit] = useState("0.00"),
    [rewardId, setRewardId] = useState(""),
    [method, setMethod] = useState("cash"),
    [selection, setSelection] = useState("");
  const command = useCommerceCommand(async () => {
    setDone(true);
    setReview(false);
    await load();
  });
  const actualKind = appointmentId
    ? data?.appointment?.canCollect
      ? "appointment"
      : "extra"
    : kind;
  useEffect(() => {
    if (!data || ready) return;
    Promise.resolve().then(() => {
      const quote = data.appointment?.quote;
      setLines(
        quoteId && quote?.id === quoteId
          ? quote.snapshot.lines.map((l) => ({ ...l, kind: "service" }))
          : actualKind === "topup"
            ? [
                {
                  kind: "topup",
                  description: "Credito prepagato nominativo TEST",
                  quantity: 1,
                  unitPriceCents: 20000,
                  discountCents: 0,
                },
              ]
            : actualKind === "appointment"
              ? (data.appointment?.lines ?? [])
              : [],
      );
      setReady(true);
    });
  }, [data, ready, actualKind, quoteId]);
  const rewards = (data?.rewards ?? []).filter(
    (r) =>
      !r.used_sale_id &&
      !r.revoked_at &&
      (!r.expires_at || Date.parse(r.expires_at) > now) &&
      r.earned_appointment_id !== appointmentId,
  );
  let totals = { total: 0, discount: 0 },
    creditCents = 0,
    problem = "";
  try {
    parseBasket(lines);
    if (lines.some((l) => l.discountCents >= l.unitPriceCents * l.quantity))
      throw new Error("Lo sconto deve essere inferiore al prezzo della voce");
    totals = promotionPreview(
      lines,
      rewards.find((r) => r.id === rewardId),
    );
    creditCents = euroInput(credit);
    if (!lines.length || totals.total <= 0)
      throw new Error("Aggiungi almeno una voce");
    if (creditCents > totals.total || creditCents > (data?.balance ?? 0))
      throw new Error(
        "Il credito utilizzato supera il totale o il saldo disponibile",
      );
    if (
      creditCents > 0 &&
      lines.some((l) => l.vatPercent != null && l.vatPercent !== 22)
    )
      throw new Error("Il credito TEST richiede voci con IVA al 22%.");
  } catch (e) {
    problem = e instanceof Error ? e.message : "Dati non validi";
  }
  const locked =
    command.busy || review || done || !!command.pending || !!quoteId;
  function change(
    index: number,
    key: "quantity" | "unitPriceCents" | "discountCents",
    value: string,
  ) {
    try {
      const n = key === "quantity" ? Number(value) : euroInput(value);
      setInputError("");
      setLines((old) =>
        old.map((l, i) => (i === index ? { ...l, [key]: n } : l)),
      );
    } catch {
      setInputError("Inserisci un importo valido prima di confermare.");
    }
  }
  function add() {
    if (selection.startsWith("p:")) {
      const p = data?.products.find((p) => p.id === selection.slice(2));
      if (p)
        setLines((old) => [
          ...old,
          {
            kind: "product",
            id: p.id,
            description: p.name,
            quantity: 1,
            unitPriceCents: p.price_cents,
            discountCents: 0,
            vatPercent: p.vat_percent,
          },
        ]);
    } else {
      const s = data?.services.find((s) => s.id === selection);
      if (s)
        setLines((old) => [
          ...old,
          {
            kind: "service",
            id: s.id,
            description: s.name,
            quantity: 1,
            unitPriceCents: s.price_cents,
            discountCents: 0,
          },
        ]);
    }
    setSelection("");
  }
  async function collect() {
    if (!data || problem || !confirmed) return;
    await command.send({
      action: "sale",
      kind: actualKind,
      appointmentId: appointmentId ?? null,
      clientId: data.appointment?.clientId ?? clientId ?? null,
      expectedUpdate: data.appointment?.updatedAt ?? null,
      lines,
      method,
      creditCents,
      rewardId: rewardId || null,
      confirmed: true,
      quoteId: quoteId ?? null,
      quoteVersion: quoteId ? data.appointment?.quote?.version : null,
    });
  }
  return (
    <Modal
      title={
        kind === "topup" && !appointmentId
          ? "Ricarica credito cliente"
          : actualKind === "extra"
            ? "Cassa · acquisti aggiuntivi"
            : "Cassa"
      }
      onClose={onClose}
      busy={command.busy}
    >
      <p className="text-sm bg-amber-50 text-amber-900 rounded-lg p-3">
        Ambiente TEST. Contanti e POS esterno vanno incassati separatamente
        prima della conferma.
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <CommandNotice command={command} />
      {!data ? (
        <p>Caricamento...</p>
      ) : (
        <>
          <p className="font-medium">
            {data.client
              ? `${data.client.first_name} ${data.client.last_name}`
              : (data.appointment?.clientName ?? "Cliente occasionale")}
          </p>
          {actualKind === "extra" && (
            <p className="bg-blue-50 rounded-lg p-3 text-sm">
              Il pagamento dell’appuntamento è già registrato o da verificare.
              Puoi aggiungere soltanto prodotti, se la vendita · attiva.
            </p>
          )}
          {!done &&
            !review &&
            !quoteId &&
            data.appointment?.canCollect &&
            data.appointment.quote?.status === "draft" && (
              <button
                className="text-blue-700 underline text-sm"
                disabled={command.busy || !!command.pending}
                onClick={() => {
                  const q = data.appointment?.quote;
                  if (q) {
                    setQuoteId(q.id);
                    setLines(
                      q.snapshot.lines.map((l) => ({ ...l, kind: "service" })),
                    );
                    setRewardId("");
                  }
                }}
              >
                Usa il preventivo salvato
              </button>
            )}
          {done ? (
            <div role="status" className="bg-green-50 rounded-lg p-4">
              <p className="font-semibold">Operazione registrata</p>
              <p className="text-sm">
                Il documento TEST è in elaborazione. Saldo disponibile:{" "}
                {money(data.balance)}.
              </p>
              <a href="/cassa" className="underline text-blue-700">
                Consulta ricevute e PDF in Cassa
              </a>
            </div>
          ) : (
            <>
              <div ref={editor} className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      {["Voce", "Quantità", "Prezzo €", "Sconto €", ""].map(
                        (t, i) => (
                          <th key={i} className="text-left p-2">
                            {t}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={`${i}-${l.id ?? l.kind}`}>
                        <td className="p-2 min-w-44">
                          {l.kind === "service" && !l.id && !quoteId ? (
                            <input
                              aria-label={`Descrizione ${i + 1}`}
                              className={field}
                              value={l.description}
                              maxLength={120}
                              disabled={locked}
                              onChange={(e) =>
                                setLines((old) =>
                                  old.map((v, n) =>
                                    n === i
                                      ? { ...v, description: e.target.value }
                                      : v,
                                  ),
                                )
                              }
                            />
                          ) : (
                            l.description
                          )}
                        </td>
                        <td className="p-2">
                          <input
                            aria-label={`Quantità ${i + 1}`}
                            className={field + " min-w-16"}
                            type="number"
                            min={1}
                            max={99}
                            value={l.quantity}
                            disabled={locked || kind === "topup"}
                            onChange={(e) =>
                              change(i, "quantity", e.target.value)
                            }
                          />
                        </td>
                        <td className="p-2">
                          <input
                            aria-label={`Prezzo ${i + 1}`}
                            className={field + " min-w-24"}
                            type="number"
                            step="0.01"
                            min="0.01"
                            key={`price-${i}-${l.kind}-${l.id}-${l.unitPriceCents}`}
                            defaultValue={(l.unitPriceCents / 100).toFixed(2)}
                            required
                            disabled={locked || l.kind === "product"}
                            onBlur={(e) =>
                              change(i, "unitPriceCents", e.target.value)
                            }
                          />
                        </td>
                        <td className="p-2">
                          <input
                            aria-label={`Sconto ${i + 1}`}
                            className={field + " min-w-24"}
                            type="number"
                            step="0.01"
                            min="0"
                            key={`discount-${i}-${l.kind}-${l.id}-${l.discountCents}`}
                            defaultValue={(l.discountCents / 100).toFixed(2)}
                            required
                            disabled={
                              locked || !!rewardId || l.kind === "topup"
                            }
                            onBlur={(e) =>
                              change(i, "discountCents", e.target.value)
                            }
                          />
                        </td>
                        <td>
                          <button
                            aria-label={`Rimuovi ${l.description}`}
                            disabled={locked || kind === "topup"}
                            onClick={() =>
                              setLines((old) => old.filter((_, n) => n !== i))
                            }
                            className="text-red-700 p-2 disabled:opacity-30"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!quoteId && kind !== "topup" && !review && (
                <div className="flex gap-2">
                  <select
                    aria-label="Aggiungi voce"
                    className={field}
                    value={selection}
                    disabled={locked}
                    onChange={(e) => setSelection(e.target.value)}
                  >
                    <option value="">Scegli una voce</option>
                    {actualKind === "appointment" && (
                      <optgroup label="Servizi">
                        {data.services.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} · {money(s.price_cents)}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {data.productsEnabled && (
                      <optgroup label="Prodotti">
                        {data.products
                          .filter((p) => p.active)
                          .map((p) => (
                            <option
                              key={p.id}
                              value={"p:" + p.id}
                              disabled={p.stock === 0}
                            >
                              {p.name} · {money(p.price_cents)} · disponibili{" "}
                              {p.stock}
                            </option>
                          ))}
                      </optgroup>
                    )}
                  </select>
                  <button
                    className={button}
                    disabled={locked || !selection || lines.length >= 30}
                    onClick={add}
                  >
                    Aggiungi
                  </button>
                </div>
              )}
              {actualKind === "appointment" && !locked && (
                <button
                  className="text-blue-700 underline text-sm"
                  disabled={lines.length >= 30}
                  onClick={() =>
                    setLines((old) => [
                      ...old,
                      {
                        kind: "service",
                        description: "Servizio aggiuntivo",
                        quantity: 1,
                        unitPriceCents: 100,
                        discountCents: 0,
                      },
                    ])
                  }
                >
                  Aggiungi servizio libero
                </button>
              )}
              {actualKind === "topup" ? (
                <p className="text-sm text-gray-500">
                  La ricarica sarà associata a questo cliente e tracciata nello
                  storico.
                </p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                  <label className="text-sm">
                    Promozione
                    <select
                      aria-label="Promozione"
                      value={rewardId}
                      disabled={locked}
                      onChange={(e) => setRewardId(e.target.value)}
                      className={field + " mt-1"}
                    >
                      <option value="">Nessuna promozione</option>
                      {rewards.map((r: Reward) => (
                        <option key={r.id} value={r.id}>
                          {r.label} ·{" "}
                          {r.percent
                            ? `${r.percent}%`
                            : money(r.amount_cents ?? 0)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    Usa credito · disponibile {money(data.balance)}
                    <input
                      aria-label="Credito da utilizzare"
                      className={field + " mt-1"}
                      value={credit}
                      disabled={
                        command.busy ||
                        review ||
                        done ||
                        !!command.pending ||
                        !data.client
                      }
                      inputMode="decimal"
                      onChange={(e) => setCredit(e.target.value)}
                    />
                    <button
                      disabled={
                        command.busy ||
                        review ||
                        done ||
                        !!command.pending ||
                        !data.client
                      }
                      onClick={() =>
                        setCredit(
                          (Math.min(data.balance, totals.total) / 100).toFixed(
                            2,
                          ),
                        )
                      }
                      className="text-blue-700 underline mt-1"
                    >
                      Usa il saldo disponibile
                    </button>
                  </label>
                </div>
              )}
              <div className="border rounded-xl p-4 space-y-2">
                <div className="flex justify-between">
                  <span>Sconto promozionale</span>
                  <span>{money(totals.discount)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Totale vendita</span>
                  <strong>{money(totals.total)}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Credito utilizzato</span>
                  <span>{money(creditCents)}</span>
                </div>
                <div className="flex justify-between text-lg">
                  <strong>Da incassare ora</strong>
                  <strong>
                    {money(Math.max(0, totals.total - creditCents))}
                  </strong>
                </div>
                {data.client && (
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>Saldo dopo l’operazione</span>
                    <span>
                      {money(
                        actualKind === "topup"
                          ? data.balance + totals.total
                          : data.balance - creditCents,
                      )}
                    </span>
                  </div>
                )}
              </div>
              {problem && <p className="text-sm text-red-700">{problem}</p>}
              <label className="block text-sm">
                Modalità dell’incasso residuo
                <select
                  aria-label="Modalità pagamento"
                  className={field + " mt-1"}
                  disabled={
                    command.busy ||
                    review ||
                    done ||
                    !!command.pending ||
                    totals.total === creditCents
                  }
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  <option value="cash">Contanti</option>
                  <option value="card">POS esterno</option>
                </select>
              </label>
              {review ? (
                <div className="border border-blue-200 rounded-xl p-4 space-y-3">
                  <label className="flex gap-2 items-start text-sm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      disabled={command.busy}
                    />
                    Confermo l’utilizzo del credito indicato e di aver ricevuto
                    l’eventuale importo residuo.
                  </label>
                  <div className="flex gap-3">
                    <button
                      className={button}
                      disabled={
                        command.busy ||
                        !confirmed ||
                        !!problem ||
                        !!inputError ||
                        !!command.pending
                      }
                      onClick={() => void collect()}
                    >
                      Conferma ed emetti TEST
                    </button>
                    <button
                      disabled={command.busy || !!command.pending}
                      onClick={() => setReview(false)}
                      className="underline"
                    >
                      Modifica
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className={button}
                  disabled={
                    command.busy ||
                    !!problem ||
                    !!inputError ||
                    !data.canSell ||
                    !!command.pending
                  }
                  onClick={() => {
                    const inputs = Array.from(
                      editor.current?.querySelectorAll<HTMLInputElement>(
                        "input",
                      ) ?? [],
                    );
                    if (inputs.some((input) => !input.reportValidity())) return;
                    setReview(true);
                    setConfirmed(false);
                  }}
                >
                  Rivedi e conferma
                </button>
              )}
            </>
          )}
          {!!data.appointment?.documents.length && (
            <div className="border-t pt-3 space-y-2">
              <h3 className="font-medium">Documenti dell’appuntamento</h3>
              {data.appointment.documents.map((d) => (
                <div key={d.id} className="flex justify-between text-sm">
                  <span>
                    {d.operation === "cancellation" ? "Annullo" : "Ricevuta"} ·{" "}
                    {money(d.amount_cents)} ·{" "}
                    {d.processing_status === "completed"
                      ? "Emesso"
                      : d.processing_status === "failed"
                        ? "Errore da verificare"
                        : "In elaborazione"}
                  </span>
                  {d.pdf_available && (
                    <a
                      className="underline text-blue-700"
                      href={`/api/cassa/${d.id}/pdf`}
                    >
                      PDF
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
