"use client";
import { useState } from "react";
import { euroInput } from "@/services/checkout/basket";
import { CommerceCheckout } from "./CommerceCheckout";
import {
  button,
  CommandNotice,
  field,
  Modal,
  money,
  useCommerce,
  useCommerceCommand,
} from "./shared";
export function ClientCredit({
  clientId,
  onClose,
}: {
  clientId: string;
  onClose: () => void;
}) {
  const [now] = useState(() => Date.now());
  const { data, error, load } = useCommerce("?clientId=" + clientId),
    [topup, setTopup] = useState(false);
  const [label, setLabel] = useState("Premio fedeltà"),
    [type, setType] = useState("percent"),
    [value, setValue] = useState("20"),
    [serviceId, setServiceId] = useState(""),
    [expiry, setExpiry] = useState("");
  const [localError, setLocalError] = useState("");
  const command = useCommerceCommand(load);
  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setLocalError("");
    try {
      await command.send({
        action: "reward",
        clientId,
        label,
        percent: type === "percent" ? Number(value) : null,
        amountCents: type === "fixed" ? euroInput(value) : null,
        serviceId: serviceId || null,
        expiresAt: expiry ? new Date(expiry + "T23:59:59").toISOString() : null,
      });
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Importo non valido");
    }
  }
  return (
    <Modal
      title={
        data?.client
          ? `${data.client.first_name} ${data.client.last_name} · credito e premi`
          : "Credito e premi"
      }
      onClose={onClose}
      busy={command.busy}
    >
      {error && <p role="alert">{error}</p>}
      <CommandNotice command={command} />
      {localError && (
        <p role="alert" className="text-red-700">
          {localError}
        </p>
      )}
      {data && (
        <>
          <div className="rounded-xl bg-blue-50 p-5 flex justify-between items-center">
            <div>
              <p className="text-sm text-blue-800">Credito disponibile TEST</p>
              <strong className="text-3xl">{money(data.balance)}</strong>
            </div>
            {data.canSell && (
              <button className={button} onClick={() => setTopup(true)}>
                Ricarica
              </button>
            )}
          </div>
          {data.rule && (
            <p className="text-sm">
              {data.rule.name}: <strong>{data.visits} visite completate</strong>{" "}
              dall’attivazione. Un premio ogni {data.rule.visits} visite.
            </p>
          )}
          <section className="space-y-2">
            <h3 className="font-semibold">Promozioni del cliente</h3>
            {!data.rewards.length && (
              <p className="text-sm text-gray-500">
                Nessuna promozione assegnata.
              </p>
            )}
            {data.rewards.map((r) => (
              <div
                key={r.id}
                className="border rounded-lg p-3 flex justify-between gap-3 text-sm"
              >
                <div>
                  <strong>{r.label}</strong> ·{" "}
                  {r.percent ? `${r.percent}%` : money(r.amount_cents ?? 0)}
                  <p className="text-gray-500">
                    {r.used_sale_id
                      ? "Utilizzata"
                      : r.revoked_at
                        ? "Revocata"
                        : r.expires_at && Date.parse(r.expires_at) < now
                          ? "Scaduta"
                          : "Disponibile sui servizi compatibili"}
                    {r.expires_at &&
                      ` · scadenza ${new Date(r.expires_at).toLocaleDateString("it-IT")}`}
                  </p>
                </div>
                {data.manager && !r.used_sale_id && !r.revoked_at && (
                  <button
                    className="text-red-700 underline"
                    disabled={command.busy || !!command.pending}
                    onClick={() =>
                      void command.send({
                        action: "revokeReward",
                        rewardId: r.id,
                      })
                    }
                  >
                    Revoca
                  </button>
                )}
              </div>
            ))}
          </section>
          {data.manager && (
            <form
              onSubmit={(e) => void grant(e)}
              className="border rounded-xl p-4 space-y-3"
            >
              <h3 className="font-semibold">Assegna una promozione</h3>
              <p className="text-sm text-gray-500">
                Premio utilizzabile una volta su un servizio. Non cumulabile con
                altri sconti; il credito acquistato resta utilizzabile.
              </p>
              <label className="block text-sm">
                Descrizione
                <input
                  className={field}
                  required
                  maxLength={120}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-sm">
                  Tipo
                  <select
                    className={field}
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                  >
                    <option value="percent">Sconto percentuale</option>
                    <option value="fixed">Sconto in euro</option>
                  </select>
                </label>
                <label className="text-sm">
                  Valore
                  <input
                    className={field}
                    type="number"
                    min="1"
                    max={type === "percent" ? 90 : 1000}
                    step={type === "percent" ? 1 : "0.01"}
                    required
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </label>
              </div>
              <label className="block text-sm">
                Servizio
                <select
                  className={field}
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                >
                  <option value="">Qualsiasi servizio</option>
                  {data.services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Scadenza facoltativa
                <input
                  className={field}
                  type="date"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                />
              </label>
              <button
                className={button}
                disabled={command.busy || !!command.pending}
              >
                Assegna premio
              </button>
            </form>
          )}
          <section>
            <h3 className="font-semibold mb-2">
              Movimenti del credito · ultimi 100
            </h3>
            {!data.movements.length ? (
              <p className="text-sm text-gray-500">Nessun movimento.</p>
            ) : (
              <ul className="divide-y">
                {data.movements.map((m) => (
                  <li key={m.id} className="flex justify-between py-3 text-sm">
                    <span>
                      {m.kind === "topup"
                        ? "Ricarica"
                        : m.kind === "spend"
                          ? "Utilizzo in cassa"
                          : "Storno"}{" "}
                      · {new Date(m.created_at).toLocaleString("it-IT")}
                    </span>
                    <strong
                      className={
                        m.delta_cents > 0 ? "text-green-700" : "text-gray-800"
                      }
                    >
                      {m.delta_cents > 0 ? "+" : ""}
                      {money(m.delta_cents)}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {topup && (
        <CommerceCheckout
          kind="topup"
          clientId={clientId}
          onClose={() => {
            setTopup(false);
            void load();
          }}
        />
      )}
    </Modal>
  );
}
