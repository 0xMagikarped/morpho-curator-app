// Type declarations for the shared (plain-JS) upstream map, so TypeScript
// consumers (notably vite.config.ts) can import it under `tsc -b`.
export const ALCHEMY_SLUGS: Record<number, string>;
export function alchemyUrl(chainId: number | string, key: string | undefined): string | null;
