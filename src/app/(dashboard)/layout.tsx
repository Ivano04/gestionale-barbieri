'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter, usePathname } from 'next/navigation';
import { CalendarDays, Users, Settings, LogOut, Menu, X, LayoutDashboard, Scissors, UserCog } from 'lucide-react';
import Link from 'next/link';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/calendar', label: 'Calendario', icon: CalendarDays },
  { href: '/services', label: 'Servizi', icon: Scissors },
  { href: '/staff', label: 'Staff', icon: UserCog },
  { href: '/clients', label: 'Clienti', icon: Users },
  { href: '/settings', label: 'Impostazioni', icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [salonName, setSalonName] = useState('LocalVista');
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: users } = await supabase.from('users').select('salon_id').eq('id', data.session.user.id).single();
      if (users?.salon_id) {
        const { data: salon } = await supabase.from('salons').select('name').eq('id', users.salon_id).single();
        if (salon) setSalonName(salon.name);
      }
    });
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const sidebar = (
    <div className="flex flex-col h-full bg-white">
      <div className="p-4 font-bold text-lg border-b flex items-center justify-between">
        <span className="truncate">{salonName}</span>
        <button onClick={() => setMobileOpen(false)} className="md:hidden p-1 hover:bg-gray-100 rounded">
          <X size={18} />
        </button>
      </div>
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {navItems.map(item => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
              pathname.startsWith(item.href)
                ? 'bg-blue-50 text-blue-700 shadow-sm'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <item.icon size={18} />
            {item.label}
          </Link>
        ))}
      </nav>
      <button onClick={handleLogout}
        className="flex items-center gap-3 px-3 py-2.5 m-2 text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 rounded-xl transition-colors">
        <LogOut size={18} /> Esci
      </button>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 bg-white border-r flex-col shadow-sm z-20">{sidebar}</aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-72 bg-white h-full shadow-2xl animate-in slide-in-from-left duration-200">
            {sidebar}
          </aside>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center justify-between p-4 bg-white border-b sticky top-0 z-10">
          <button onClick={() => setMobileOpen(true)} className="p-2 hover:bg-gray-100 rounded-xl">
            <Menu size={22} />
          </button>
          <span className="font-bold text-lg">{salonName}</span>
          <div className="w-10" />
        </div>
        {children}
      </main>
    </div>
  );
}
