/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== 'production';

// Origins the browser app talks to (REST + socket.io), in http(s) and ws(s) forms.
function origins(...urls) {
  const out = new Set();
  for (const u of urls) {
    try {
      const { protocol, host } = new URL(u);
      out.add(`${protocol}//${host}`);
      out.add(`${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}`);
    } catch { /* ignore invalid */ }
  }
  return [...out];
}

const DEFAULT_API = 'https://canteen-rush-ai.onrender.com';
const apiOrigins = origins(
  process.env.NEXT_PUBLIC_API_URL || DEFAULT_API,
  process.env.NEXT_PUBLIC_SOCKET_URL || DEFAULT_API,
);

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://res.cloudinary.com",
  "font-src 'self' data:",
  `connect-src ${[
    "'self'",
    ...apiOrigins,
    'https://*.googleapis.com',
    'https://*.firebaseio.com',
    'https://securetoken.googleapis.com',
    'https://identitytoolkit.googleapis.com',
    'https://*.firebaseapp.com',
    ...(isDev ? ['ws://localhost:*', 'http://localhost:*'] : []),
  ].join(' ')}`,
  "frame-src https://*.firebaseapp.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'res.cloudinary.com' }],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
