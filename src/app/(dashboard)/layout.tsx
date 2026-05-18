'use client';
import { createClient } from '@/lib/supabase/client';
import { useRouter, usePathname } from 'next/navigation';
import { useState } from 'react';
import { CalendarDays, Users, Settings, LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';

const navItems = [
  { href: '/calendar', label: 'Calendario', icon: CalendarDays },
  { href: '/clients', label: 'Clienti', icon: Users },
  { href: '/settings', label: 'Impostazioni', icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="p-4 font-bold text-xl border-b">Hairforce</div>
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              pathname.startsWith(item.href) ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <item.icon size={18} />
            {item.label}
          </Link>
        ))}
      </nav>
      <button onClick={handleLogout}
        className="flex items-center gap-3 px-3 py-2 m-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
        <LogOut size={18} /> Esci
      </button>
    </div>
  );

  return (
    <div className="flex h-screen">
      <aside className="hidden md:flex w-56 bg-white border-r flex-col">{sidebar}</aside>
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-64 bg-white h-full">{sidebar}</aside>
        </div>
      )}
      <main className="flex-1 overflow-auto">
        <div className="md:hidden p-4">
          <button onClick={() => setMobileOpen(true)}><Menu size={24} /></button>
        </div>
        {children}
      </main>
    </div>
  );
}
