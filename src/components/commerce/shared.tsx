"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CommerceData } from "@/services/commerce/types";
export const money = (cents: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
export const field =
  "border border-gray-300 rounded-lg px-3 py-2 text-sm w-full disabled:bg-gray-50";
export const button =
  "rounded-lg bg-blue-600 px-4 py-2 text-white text-sm disabled:opacity-40";
export function useCommerce(query: string) {
  const [data, setData] = useState<CommerceData | null>(null),
    [error, setError] = useState("");
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    const r = await fetch("/api/commerce" + query, { cache: "no-store" });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || "Dati non disponibili");
    if (current === generation.current) {
      setData(body);
      setError("");
    }
    return body as CommerceData;
  }, [query]);
  useEffect(() => {
    let active = true;
    load().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [load]);
  return { data, error, setError, load };
}
export function useCommerceCommand(onSuccess: () => Promise<unknown>) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const v = sessionStorage.getItem("commerce-pending");
        if (v) setPending(JSON.parse(v));
      } catch {
        /* Storage unavailable. */
      }
    });
  }, []);
  const inFlight = useRef(false);
  async function send(body: Record<string, unknown>, replay = false) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      let existing: Record<string, unknown> | null = pending;
      try {
        existing = JSON.parse(
          sessionStorage.getItem("commerce-pending") || "null",
        );
      } catch {
        /* Use memory fallback. */
      }
      if (existing && !replay)
        throw new Error(
          "Prima verifica la precedente operazione con esito incerto.",
        );
      const input =
        replay && existing
          ? existing
          : { ...body, requestId: crypto.randomUUID() };
      setPending(input);
      try {
        sessionStorage.setItem("commerce-pending", JSON.stringify(input));
      } catch {
        /* Same key retained in memory. */
      }
      const r = await fetch("/api/commerce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await r.json();
      if (r.ok || r.status < 500) {
        setPending(null);
        try {
          sessionStorage.removeItem("commerce-pending");
        } catch {
          /* No storage. */
        }
      }
      if (!r.ok) throw new Error(result.error || "Esito non disponibile");
      try {
        await onSuccess();
      } catch {
        setError(
          "Operazione registrata. Aggiorna la pagina per vedere i dati.",
        );
      }
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Connessione interrotta. Verifica la precedente operazione.",
      );
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { send, busy, error, pending };
}
export function CommandNotice({
  command,
}: {
  command: ReturnType<typeof useCommerceCommand>;
}) {
  return (
    <>
      {command.error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
        >
          {command.error}
        </p>
      )}
      {command.pending && !command.busy && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm">
          Esito della precedente operazione da verificare.{" "}
          <button
            className="underline"
            onClick={() => void command.send({}, true)}
          >
            Verifica / riprendi operazione
          </button>
        </div>
      )}
    </>
  );
}
export function Modal({
  title,
  onClose,
  busy,
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-3"
      onClick={(e) => e.stopPropagation()}
    >
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[94vh] overflow-auto"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onClose();
          if (e.key !== "Tab") return;
          const items = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>(
              "button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href]",
            ),
          );
          const first = items[0],
            last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="sticky top-0 z-10 bg-white border-b p-5 flex items-center justify-between">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button
            aria-label="Chiudi"
            disabled={busy}
            onClick={onClose}
            className="p-2"
          >
            ×
          </button>
        </header>
        <div className="p-5 space-y-4">{children}</div>
      </section>
    </div>
  );
}
