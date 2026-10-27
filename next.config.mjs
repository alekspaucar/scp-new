/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
  async rewrites() {
    // This project only talks to its own loopback service, never the plant.
    const port = process.env.SGP_NUEVA_PORT || '5101'
    if (!/^\d{4,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535 || Number(port) === 5001) throw new Error('Puerto inválido para el backend independiente')
    const destination = `http://127.0.0.1:${Number(port)}`
    return [
      { source: '/api/:path*', destination: `${destination}/api/:path*` },
      { source: '/uploads/:path*', destination: `${destination}/uploads/:path*` },
      { source: '/logout', destination: `${destination}/logout` },
    ]
  },
}

export default nextConfig
