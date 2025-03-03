declare global {
  interface Window {
    ENV?: {
      NEXT_PUBLIC_WS_URL?: string;
    };
  }
}

// Use window.ENV if available, otherwise fall back to environment variable
export const WS_URL = (
  typeof window !== 'undefined' && window.ENV?.NEXT_PUBLIC_WS_URL 
    ? window.ENV.NEXT_PUBLIC_WS_URL 
    : process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000') + '?Authorization=Bearer test API'
