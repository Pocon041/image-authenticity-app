import { join, resolve } from 'node:path'

let runtimeDirectory: string | undefined
let bundledBackendDirectory: string | undefined

export function configureRuntimePaths(
  directory: string | undefined,
  backendDirectory?: string
): void {
  runtimeDirectory = directory
  bundledBackendDirectory = backendDirectory
}

export function getRuntimeRoot(fallback = process.cwd()): string {
  return runtimeDirectory ?? resolve(process.env.SRDP_RUNTIME_ROOT ?? fallback)
}

export function getBackendPath(root: string, relativePath: string): string {
  return join(bundledBackendDirectory ?? join(root, 'backend'), relativePath)
}
