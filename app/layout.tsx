import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'FitClass Leads Dashboard',
  description: 'Internal lead management for FitClass branches',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/*
        Viewport policy:
          - Mobile/tablet (< lg): natural document scroll. body has no
            height clamp and NO overflow lock, so the viewport scrolls
            normally — content can grow past the fold and remain reachable.
          - Desktop (≥ lg): rigid 100dvh shell. The dashboard's AG Grid
            owns the only scroll region; the page itself doesn't scroll.
        The `dashboard-shell` class on the body handles the breakpoint via
        CSS (lg:overflow-hidden / lg:h-dvh). Doing this in CSS instead of
        inline style avoids the SSR/CSR flash and keeps the grid pinned.
      */}
      <body
        className={`${inter.className} dashboard-shell bg-[#F8FAFC]`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
