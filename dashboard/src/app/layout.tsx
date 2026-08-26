import type { Metadata } from 'next';
import { Space_Grotesk, Inter_Tight, JetBrains_Mono, Noto_Nastaliq_Urdu } from 'next/font/google';
import './globals.css';
import { THEME_BOOT } from '@/components/ThemeToggle';

// Display: Space Grotesk for the wordmark and column heads — geometric and
// precise, which is what Nocturne wants. Body: Inter Tight is denser than Inter,
// and density is the whole point once a column holds twenty tickets. Mono:
// order numbers, money and clocks are data, and data has always been monospaced
// on a kitchen ticket.
const display = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display-loaded',
  display: 'swap',
});
const body = Inter_Tight({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body-loaded',
  display: 'swap',
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-mono-loaded',
  display: 'swap',
});

// The risk in this design, and the reason it could not be any other kitchen:
// the column heads carry Urdu alongside English. The customers order in Roman
// Urdu, the staff are Lahori, and Nastaliq is the script this city actually
// reads. Kept small and secondary so it never competes with the operational
// English — presence, not decoration.
const urdu = Noto_Nastaliq_Urdu({
  subsets: ['arabic'],
  weight: ['400'],
  variable: '--font-urdu-loaded',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Tandoor Pass',
  description: 'Live order board for Tandoor & Bun',
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f4f7' },
    { media: '(prefers-color-scheme: dark)', color: '#14171c' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable} ${urdu.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body
        style={
          {
            '--font-display': `var(--font-display-loaded), ui-sans-serif, system-ui, sans-serif`,
            '--font-body': `var(--font-body-loaded), ui-sans-serif, system-ui, sans-serif`,
            '--font-mono': `var(--font-mono-loaded), ui-monospace, monospace`,
            '--font-urdu': `var(--font-urdu-loaded), serif`,
          } as React.CSSProperties
        }
      >
        {children}
      </body>
    </html>
  );
}
