// The few Node APIs the build config and tests use, so the project needs no @types/node.
declare const process: { env: Record<string, string | undefined> };
declare module 'node:child_process' {
  export function execSync(cmd: string): { toString(): string };
}
// …and the two the piece-recognition test reads its screenshot fixture with.
declare module 'node:fs' {
  export function readFileSync(path: URL | string): Uint8Array;
}
declare module 'node:zlib' {
  export function gunzipSync(data: Uint8Array): Uint8Array;
}
