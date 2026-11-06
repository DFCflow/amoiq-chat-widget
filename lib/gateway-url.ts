/**
 * Base URL for every widget call to the communication gateway.
 * NEXT_PUBLIC_* values are inlined at build time, so a build without them uses the default.
 */
export const GATEWAY_BASE_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'https://gw.communication.amilogy.com';
