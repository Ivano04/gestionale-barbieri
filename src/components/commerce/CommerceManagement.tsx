"use client";
import { useState } from "react";
import { euroInput } from "@/services/checkout/basket";
import type { CommerceSale, Product } from "@/services/commerce/types";
import { CommerceCheckout } from "./CommerceCheckout";
import { ClientCredit } from "./ClientCredit";
import {
  button,
  CommandNotice,
  field,
  Modal,
  money,
  useCommerce,
  useCommerceCommand,
} from "./shared";
export function CommerceManagement({
  initialTab = "clients",
}: {
  initialTab?: "clients" | "products" | "sales";
}) {
  const [tab, setTab] = useState(
      initialTab as "clients" | "products" | "sales" | "loyalty",
    ),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const { data, error, load } = useCommerce(
    query ? "?q=" + encodeURIComponent(query) : "",
  );
  const command = useCommerceCommand(load);
  const [selected, setSelected] = useState<string | null>(null),
    [retail, setRetail] = useState(false),
    [editing, setEditing] = useState<Product | null | undefined>(undefined),
    [stock, setStock] = useState<Product | null>(null),
    [reverse, setReverse] = useState<CommerceSale | null>(null);
  const [localError, setLocalError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>, action: string) {
    e.preventDefault();
    setLocalError("");
    const f = new FormData(e.currentTarget);
    const value = (key: string) => String(f.get(key) ?? "");
    try {
      let body: Record<string, unknown> = { action };
      if (action === "product")
        body = {
          ...body,
          id: editing?.id ?? null,
          name: value("name"),
          sku: value("sku"),
          priceCents: euroInput(value("price")),
          vatPercent: Number(value("vat")),
          minimumStock: Number(value("minimum")),
          active: f.get("active") === "on",
        };
      if (action === "stock")
        body = {
          ...body,
          productId: stock?.id,
          quantity: Number(value("quantity")),
          reason: value("reason"),
        };
      if (action === "rule")
        body = {
          ...body,
          enabled: true,
          name: value("name"),
          visits: Number(value("visits")),
          percent: Number(value("percent")),
          serviceId: value("service") || null,
        };
      if (action === "reverse")
        body = {
          ...body,
          saleId: reverse?.id,
          confirmed: f.get("confirmed") === "on",
          restock: f.get("restock") === "on",
          reason: value("reason"),
        };
      if (await command.send(body)) {
        setEditing(undefined);
        setStock(null);
        setReverse(null);
      }
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Dati non validi");
    }
  }
  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex justify-between items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            Credito, promozioni e magazzino
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Gestione in ambiente TEST
          </p>
        </div>
        <button
          className="border rounded-lg p-2 text-sm"
          onClick={() => void load()}
        >
          Aggiorna
        </button>
      </div>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <CommandNotice command={command} />
      {localError && (
        <p role="alert" className="text-red-700">
          {localError}
        </p>
      )}
      {data && (
        <>
          <div className="grid md:grid-cols-3 gap-3">
            {[
              [
                "Credito ancora disponibile ai clienti",
                data.totals.creditOutstanding,
              ],
              [
                "Incassi in salone, al netto degli annulli",
                data.totals.cashReceived,
              ],
              [
                "Credito utilizzato, al netto degli annulli",
                data.totals.creditUsed,
              ],
            ].map(([label, value]) => (
              <div key={label} className="bg-white border rounded-xl p-4">
                <p className="text-sm text-gray-500">{label}</p>
                <strong className="text-2xl">{money(Number(value))}</strong>
              </div>
            ))}
          </div>
          <nav
            aria-label="Gestione commerciale"
            className="flex flex-wrap gap-2"
          >
            {(
              [
                ["clients", "Clienti e credito"],
                ["loyalty", "Fedeltà"],
                ["products", "Prodotti e magazzino"],
                ["sales", "Vendite in salone"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-lg px-4 py-2 text-sm ${tab === key ? "bg-blue-600 text-white" : "bg-white border"}`}
              >
                {label}
              </button>
            ))}
          </nav>
          {tab === "clients" && (
            <section className="bg-white border rounded-xl p-4 space-y-4">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setQuery(search);
                }}
              >
                <input
                  aria-label="Cerca cliente"
                  className={field}
                  placeholder="Cerca nome o cognome"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button className={button}>Cerca</button>
              </form>
              <p className="text-xs text-gray-500">
                Primi 100 risultati. Usa la ricerca per trovare un cliente.
              </p>
              <ul className="divide-y">
                {data.clients.map((c) => (
                  <li
                    key={c.id}
                    className="py-3 flex justify-between items-center"
                  >
                    <span>
                      {c.first_name} {c.last_name}
                    </span>
                    <button
                      onClick={() => setSelected(c.id)}
                      className="text-blue-700 underline text-sm"
                    >
                      Credito e premi
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {tab === "loyalty" && (
            <section className="bg-white border rounded-xl p-5 space-y-4">
              <h2 className="font-semibold text-lg">
                Premio dopo un numero di visite
              </h2>
              <p className="text-sm text-gray-600">
                Contano gli appuntamenti segnati come completati, terminati e
                successivi all’attivazione della regola. Il premio si usa dalla
                visita successiva, una sola volta.
              </p>
              {data.rule ? (
                <div className="bg-blue-50 rounded-lg p-4">
                  <strong>{data.rule.name}</strong>
                  <p className="text-sm">
                    Ogni {data.rule.visits} visite: sconto del{" "}
                    {data.rule.percent}%{" "}
                    {data.rule.service_id
                      ? `su ${data.services.find((s) => s.id === data.rule?.service_id)?.name ?? "servizio selezionato"}`
                      : "su un servizio"}
                    .
                  </p>
                  {data.manager && (
                    <button
                      className="underline text-sm mt-2"
                      disabled={command.busy || !!command.pending}
                      onClick={() =>
                        void command.send({ action: "rule", enabled: false })
                      }
                    >
                      Disattiva nuovi premi automatici
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-sm">
                  Nessuna regola attiva. Le promozioni individuali si assegnano
                  dalla scheda del cliente.
                </p>
              )}
              {data.manager && (
                <form
                  onSubmit={(e) => void submit(e, "rule")}
                  className="space-y-3 max-w-xl"
                >
                  <h3 className="font-medium">
                    {data.rule ? "Sostituisci la regola" : "Attiva una regola"}
                  </h3>
                  <label className="block text-sm">
                    Nome
                    <input
                      className={field}
                      name="name"
                      defaultValue="Premio 10 visite"
                      required
                      maxLength={120}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-sm">
                      Visite necessarie
                      <input
                        className={field}
                        name="visits"
                        type="number"
                        min={1}
                        max={100}
                        defaultValue={10}
                        required
                      />
                    </label>
                    <label className="text-sm">
                      Sconto percentuale
                      <input
                        className={field}
                        name="percent"
                        type="number"
                        min={1}
                        max={90}
                        defaultValue={20}
                        required
                      />
                    </label>
                  </div>
                  <label className="block text-sm">
                    Servizio valido per conteggio e premio
                    <select className={field} name="service">
                      <option value="">Qualsiasi servizio</option>
                      {data.services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-sm text-gray-500">
                    Una nuova regola avvia un nuovo conteggio. I premi già
                    maturati restano nello storico dei clienti. Lo sconto non ·
                    legato a recensioni.
                  </p>
                  <button
                    className={button}
                    disabled={command.busy || !!command.pending}
                  >
                    {data.rule ? "Avvia nuovo conteggio" : "Attiva programma"}
                  </button>
                </form>
              )}
            </section>
          )}
          {tab === "products" && (
            <section className="bg-white border rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap gap-3 justify-between">
                <div>
                  <h2 className="font-semibold text-lg">
                    Prodotti e magazzino
                  </h2>
                  <p className="text-sm text-gray-500">
                    Vendita prodotti{" "}
                    {data.productsEnabled
                      ? "attiva"
                      : "disattivata per questo salone"}
                    .
                  </p>
                </div>
                {data.manager && (
                  <button
                    className="border rounded-lg px-3 py-2 text-sm"
                    disabled={command.busy || !!command.pending}
                    onClick={() =>
                      void command.send({
                        action: "settings",
                        enabled: !data.productsEnabled,
                      })
                    }
                  >
                    {data.productsEnabled
                      ? "Disattiva vendita prodotti"
                      : "Abilita vendita prodotti"}
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                {data.manager && (
                  <button className={button} onClick={() => setEditing(null)}>
                    Aggiungi prodotto
                  </button>
                )}
                {data.productsEnabled && data.canSell && (
                  <button className={button} onClick={() => setRetail(true)}>
                    Vendi prodotti
                  </button>
                )}
              </div>
              {!data.products.length ? (
                <p className="text-sm text-gray-500">
                  Nessun prodotto inserito. Il magazzino è pronto per
                  un?attivazione futura.
                </p>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        {[
                          "Prodotto",
                          "Codice",
                          "Prezzo",
                          "Disponibili",
                          "Azioni",
                        ].map((t) => (
                          <th key={t} className="p-2 text-left">
                            {t}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.products.map((p) => (
                        <tr key={p.id} className="border-t">
                          <td className="p-2">
                            {p.name}
                            {!p.active && " · archiviato"}
                          </td>
                          <td className="p-2">{p.sku}</td>
                          <td className="p-2">
                            {money(p.price_cents)} · IVA {p.vat_percent}%
                          </td>
                          <td
                            className={`p-2 ${p.stock <= p.minimum_stock ? "text-amber-700 font-semibold" : ""}`}
                          >
                            {p.stock}
                            {p.stock <= p.minimum_stock && " · scorta bassa"}
                          </td>
                          <td className="p-2">
                            {data.manager && (
                              <div className="flex gap-3">
                                <button
                                  onClick={() => setEditing(p)}
                                  className="underline"
                                >
                                  Modifica
                                </button>
                                <button
                                  onClick={() => setStock(p)}
                                  className="underline"
                                >
                                  Carico / rettifica
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!!data.stockMovements.length && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium">
                    Ultimi 50 movimenti
                  </summary>
                  <ul className="divide-y mt-2">
                    {data.stockMovements.map((m) => (
                      <li key={m.id} className="py-2 text-sm">
                        {new Date(m.created_at).toLocaleString("it-IT")} ·{" "}
                        {data.products.find((p) => p.id === m.product_id)
                          ?.name ?? "Prodotto"}{" "}
                        · {m.quantity > 0 ? "+" : ""}
                        {m.quantity} · {m.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}
          {tab === "sales" && (
            <section className="bg-white border rounded-xl p-5 space-y-3">
              <h2 className="font-semibold">Ultime 50 vendite in salone</h2>
              <p className="text-sm text-gray-500">
                I pagamenti online e tutti i documenti restano nella pagina
                Cassa. Qui trovi ricariche, utilizzi del credito e vendite del
                salone.
              </p>
              {data.sales.map((s) => (
                <article key={s.id} className="border rounded-xl p-4 space-y-2">
                  <div className="flex justify-between gap-3">
                    <strong>
                      {s.snapshot.clientName ?? "Cliente occasionale"} ·{" "}
                      {s.kind === "topup"
                        ? "Ricarica"
                        : s.kind === "extra"
                          ? "Prodotti aggiuntivi"
                          : s.kind === "retail"
                            ? "Vendita prodotti"
                            : "Servizi"}
                    </strong>
                    <span className="text-sm">
                      {new Date(s.created_at).toLocaleString("it-IT")}
                    </span>
                  </div>
                  <p className="text-sm">
                    Totale {money(s.amount_cents)} · credito{" "}
                    {money(s.credit_cents)} · incassato {money(s.tender_cents)}{" "}
                    ({s.payment_method === "cash" ? "contanti" : "POS esterno"})
                  </p>
                  <ul className="text-sm text-gray-500">
                    {s.snapshot.lines.map((l, i) => (
                      <li key={i}>
                        {l.quantity} · {l.description}
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-3 flex-wrap text-sm">
                    {s.documents.map((d) => (
                      <span key={d.id}>
                        {d.operation === "cancellation"
                          ? "Annullo"
                          : "Ricevuta"}
                        :{" "}
                        {d.processing_status === "completed"
                          ? "emesso"
                          : d.processing_status === "failed"
                            ? "errore da verificare"
                            : "in elaborazione"}{" "}
                        {d.pdf_storage_path && (
                          <a
                            className="underline text-blue-700"
                            href={`/api/cassa/${d.id}/pdf`}
                          >
                            PDF
                          </a>
                        )}
                      </span>
                    ))}
                  </div>
                  {s.reversals.length ? (
                    <p className="text-sm text-amber-800">
                      Storno registrato. Verifica sopra l’esito dell’annullo
                      fiscale.
                    </p>
                  ) : (
                    data.manager &&
                    !!s.request_snapshot && (
                      <button
                        className="text-red-700 underline text-sm"
                        onClick={() => setReverse(s)}
                      >
                        Annullo integrale TEST
                      </button>
                    )
                  )}
                </article>
              ))}
            </section>
          )}
        </>
      )}
      {selected && (
        <ClientCredit
          clientId={selected}
          onClose={() => {
            setSelected(null);
            void load();
          }}
        />
      )}
      {retail && (
        <CommerceCheckout
          kind="retail"
          onClose={() => {
            setRetail(false);
            void load();
          }}
        />
      )}
      {editing !== undefined && (
        <Modal
          title={editing ? "Modifica prodotto" : "Nuovo prodotto"}
          busy={command.busy}
          onClose={() => setEditing(undefined)}
        >
          <CommandNotice command={command} />
          {localError && <p role="alert">{localError}</p>}
          <form
            className="space-y-3"
            onSubmit={(e) => void submit(e, "product")}
          >
            <label className="block text-sm">
              Nome
              <input
                className={field}
                name="name"
                required
                maxLength={120}
                defaultValue={editing?.name}
              />
            </label>
            <label className="block text-sm">
              Codice prodotto
              <input
                className={field}
                name="sku"
                required
                maxLength={60}
                defaultValue={editing?.sku}
              />
            </label>
            <label className="block text-sm">
              Prezzo di vendita €
              <input
                className={field}
                name="price"
                type="number"
                step="0.01"
                min="0.01"
                required
                defaultValue={
                  editing ? (editing.price_cents / 100).toFixed(2) : ""
                }
              />
            </label>
            <label className="block text-sm">
              IVA
              <select
                className={field}
                name="vat"
                defaultValue={editing?.vat_percent ?? 22}
              >
                {[22, 10, 5, 4].map((v) => (
                  <option key={v} value={v}>
                    {v}%
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Scorta minima
              <input
                className={field}
                name="minimum"
                type="number"
                min={0}
                required
                defaultValue={editing?.minimum_stock ?? 2}
              />
            </label>
            <label className="flex gap-2 text-sm">
              <input
                name="active"
                type="checkbox"
                defaultChecked={editing?.active ?? true}
              />
              Disponibile per la vendita
            </label>
            <p className="text-sm text-gray-500">
              Le quantità si registrano con ?Carico / rettifica? dopo il
              salvataggio.
            </p>
            <button
              className={button}
              disabled={command.busy || !!command.pending}
            >
              Salva prodotto
            </button>
          </form>
        </Modal>
      )}
      {stock && (
        <Modal
          title={"Magazzino · " + stock.name}
          busy={command.busy}
          onClose={() => setStock(null)}
        >
          <CommandNotice command={command} />
          <form className="space-y-3" onSubmit={(e) => void submit(e, "stock")}>
            <p>Disponibili: {stock.stock}</p>
            <label className="block text-sm">
              Quantità da aggiungere o sottrarre
              <input
                className={field}
                name="quantity"
                type="number"
                required
                step={1}
                defaultValue={1}
              />
            </label>
            <label className="block text-sm">
              Motivo
              <input
                className={field}
                name="reason"
                required
                maxLength={200}
                placeholder="Es. nuovo carico, rettifica inventario"
              />
            </label>
            <button
              className={button}
              disabled={command.busy || !!command.pending}
            >
              Registra movimento
            </button>
          </form>
        </Modal>
      )}
      {reverse && (
        <Modal
          title="Annullo integrale TEST"
          busy={command.busy}
          onClose={() => setReverse(null)}
        >
          <CommandNotice command={command} />
          <form
            className="space-y-3"
            onSubmit={(e) => void submit(e, "reverse")}
          >
            <p className="text-sm">
              Disponibile nella giornata della vendita, dopo l’emissione del
              documento. Ripristina {money(reverse.credit_cents)} di credito
              {reverse.kind === "topup"
                ? ` e rimuove la ricarica di ${money(reverse.amount_cents)}`
                : ""}
              . L’annullo fiscale sarà elaborato separatamente.
            </p>
            <label className="block text-sm">
              Motivo
              <input className={field} name="reason" required maxLength={200} />
            </label>
            {reverse.snapshot.lines.some((l) => l.kind === "product") && (
              <label className="flex gap-2 text-sm">
                <input name="restock" type="checkbox" />I prodotti sono stati
                restituiti e possono rientrare nel magazzino.
              </label>
            )}
            <label className="flex gap-2 text-sm">
              <input name="confirmed" type="checkbox" required />
              Confermo l’annullo dell’intera operazione e di aver restituito
              l’eventuale importo incassato di {money(reverse.tender_cents)}. Il
              gestionale non esegue rimborsi sul POS.
            </label>
            <button
              className={button}
              disabled={command.busy || !!command.pending}
            >
              Registra storno ed emetti annullo TEST
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
