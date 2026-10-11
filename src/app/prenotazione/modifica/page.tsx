import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ModificaClient } from './ModificaClient';
export const metadata: Metadata = { title: 'Modifica appuntamento', referrer: 'no-referrer', robots: { index: false, follow: false } };
export default function ModificaPage() {
  return <Suspense fallback={<p>Caricamento...</p>}><ModificaClient /></Suspense>;
}
