/** @type {import('next').NextConfig} */
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

const nextConfig = {
  reactStrictMode: true,
  env: {
    BACKEND_URL,
  },
  // Proxy /api/* through Next.js so cookies are first-party (same domain as
  // the frontend). Without this, browsers (Safari ITP, Chrome CHIPS) block the
  // httpOnly refresh token cookie because it originates from a different Render
  // subdomain, causing every page-reload to log the user out.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
