import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export async function provenancePython(root: string): Promise<string> {
  try {
    const value = JSON.parse(
      (await readFile(join(root, 'config/provenance.local.json'), 'utf8')).replace(/^\uFEFF/, '')
    )
    if (typeof value.pythonPath !== 'string' || !value.pythonPath.trim())
      throw new Error('来源解析 Python 配置无效。')
    return value.pythonPath.includes('/') || value.pythonPath.includes('\\')
      ? resolve(root, value.pythonPath)
      : value.pythonPath
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return join(
      root,
      process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python'
    )
  }
}
