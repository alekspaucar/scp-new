import type { Metadata, Viewport } from 'next'
import { SessionProvider } from '@/components/session-provider'
import { ConfirmationProvider } from '@/components/confirmation-provider'
import './globals.css'

export const metadata: Metadata = {
  title: 'PROPRINT · Plataforma de producción',
  description: 'Gestión de pedidos, producción y bodega de Proprint. Instalación independiente.',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#f4f7fb',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es">
      <body className="antialiased">
        <SessionProvider><ConfirmationProvider>{children}</ConfirmationProvider></SessionProvider>
      </body>
    </html>
  )
}
