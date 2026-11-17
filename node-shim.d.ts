// The two Node APIs vite.config.ts uses, so the project needs no @types/node.
declare const process: { env: Record<string, string | undefined> };
declare module 'node:child_process' {
  export function execSync(cmd: string): { toString(): string };
}
