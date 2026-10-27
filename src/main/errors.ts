import type { ErrorCode, Response } from '../shared/contracts'

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string
  ) {
    super(message)
  }
}

export function failure(error: unknown, fallbackCode: ErrorCode = 'INTERNAL'): Response<never> {
  if (error instanceof AppError) return { ok: false, code: error.code, error: error.message }
  if (fallbackCode === 'INVALID_IMAGE' && error instanceof Error) {
    return { ok: false, code: fallbackCode, error: error.message }
  }
  console.error('[desktop]', error)
  return { ok: false, code: fallbackCode, error: '操作失败，请重试。' }
}
