import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Finiquito Smart Raya',
  description: 'Calculadora interna de finiquitos Grupo Raya',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
