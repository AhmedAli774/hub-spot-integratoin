const candidates = [
  import.meta.env.PUBLIC_API_BASE,
  import.meta.env.VITE_API_BASE,
  (import.meta.env as Record<string, unknown>).PUBLIC_API_BASE,
] as unknown[];

export const API_BASE: string = (() => {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      return c.trim().replace(/\/$/, '');
    }
  }
  return 'https://quilt-irregular-squabble.ngrok-free.dev';
})();

export function apiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path;
}
