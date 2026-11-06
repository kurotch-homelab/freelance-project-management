export const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    // Forma components use style attributes for dynamic dimensions.
    "style-src-attr 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
} as const;
