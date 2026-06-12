'use client';

/**
 * Persistent left sidebar — desktop only (`hidden lg:flex`, ≥1024px).
 * Below the `lg` breakpoint, the mobile/tablet drawer in SidebarController
 * takes over (rendered from the dashboard layout). Active-link highlight
 * uses `usePathname`, hence the client boundary.
 *
 * Items are filtered by role at the SOURCE — see src/config/navigation.ts.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { UserRole } from '@/src/types/auth';
import { navItemsForRole } from '@/src/config/navigation';

interface Props {
  role: UserRole;
}

export default function DashboardSidebar({ role }: Props) {
  const pathname = usePathname();
  const items = navItemsForRole(role);

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-[#E2E8F0] bg-white lg:flex">
      <nav className="flex flex-col gap-1 p-4" aria-label="Primary">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'rounded-lg bg-[#EFF6FF] px-3 py-2 text-sm font-semibold text-[#0b6cbf]'
                  : 'rounded-lg px-3 py-2 text-sm font-medium text-[#475569] transition-colors hover:bg-[#F8FAFC] hover:text-[#0F172A]'
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
