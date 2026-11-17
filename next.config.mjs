export default {
  serverExternalPackages: ['firebase-admin', 'playwright', 'playwright-core', '@sparticuz/chromium'],
  outputFileTracingIncludes: {
    '/api/\\[...action\\]': [
      './public/seqmo-logo.png',
      './node_modules/@sparticuz/chromium/bin/**/*',
      './node_modules/@fontsource-variable/noto-sans-jp/index.css',
      './node_modules/@fontsource-variable/noto-sans-jp/files/*.woff2',
    ],
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    }];
  },
};
