export const norm = (p: string) => p.replace(/\\/g, '/');
export const capitalize = (p?: string | null): string => {
  if (!p) return '';
  return p.charAt(0).toUpperCase() + p.slice(1);
};