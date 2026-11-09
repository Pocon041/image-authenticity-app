import { app } from 'electron'
import { constants } from 'node:fs'
import {
  access,
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { RuntimeEnvironment } from '../shared/contracts'
import { AppError } from './errors'
import { configureRuntimePaths } from './runtime-paths'
import { runtimeSetupStatus } from './runtime-bootstrap'
import { startManagedOllama, stopManagedOllama } from './managed-ollama'

const modelNames = ['rita', 'sica', 'rise', 'aigc', 'router', 'provenance', 'explanation'] as const
let selectedDirectory: string | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'runtime-directory.json')
}

function applyDirectory(directory: string | null): void {
  if (selectedDirectory !== directory) stopManagedOllama()
  selectedDirectory = directory
  configureRuntimePaths(
    directory ?? undefined,
    app.isPackaged ? join(process.resourcesPath, 'backend') : undefined
  )
}

export async function initializeRuntimeEnvironment(): Promise<void> {
  if (!app.isPackaged) {
    applyDirectory(resolve(process.env.SRDP_RUNTIME_ROOT ?? app.getAppPath()))
    return
  }
  let directory = process.env.SRDP_RUNTIME_ROOT
  if (!directory) {
    try {
      const settings = JSON.parse(await readFile(settingsPath(), 'utf8'))
      if (typeof settings.directory === 'string') directory = settings.directory
    } catch {
      // A new installation starts with an explicit directory selection.
    }
  }
  if (directory) {
    try {
      const path = await realpath(resolve(directory))
      if ((await stat(path)).isDirectory()) {
        await access(path, constants.W_OK)
        applyDirectory(path)
        await startManagedOllama(path).catch(() => {})
        return
      }
    } catch {
      // A disconnected drive can be selected again from the application.
    }
  }
  applyDirectory(null)
}

export async function runtimeEnvironment(): Promise<RuntimeEnvironment> {
  const configurations = await Promise.all(
    modelNames.map(async (name) => {
      let configured = false
      if (selectedDirectory) {
        try {
          configured = (
            await stat(join(selectedDirectory, 'config', `${name}.local.json`))
          ).isFile()
        } catch {
          // Missing configuration is displayed separately from a successful inference.
        }
      }
      return { name, configured }
    })
  )
  return {
    packaged: app.isPackaged,
    version: app.getVersion(),
    directory: selectedDirectory,
    configurations,
    setup: await runtimeSetupStatus(selectedDirectory)
  }
}

export function requireRuntimeEnvironment(): void {
  if (app.isPackaged && !selectedDirectory)
    throw new AppError('MODEL_NOT_READY', '请先在“本地运行环境”中选择模型与报告目录。')
}

export async function selectRuntimeDirectory(
  directory: string,
  beforeChange: () => void
): Promise<RuntimeEnvironment> {
  const path = await realpath(directory)
  if (!(await stat(path)).isDirectory()) throw new AppError('INVALID_REQUEST', '请选择文件夹。')
  const installation = await realpath(app.isPackaged ? dirname(process.execPath) : app.getAppPath())
  const difference = relative(installation, path)
  if (app.isPackaged && (!difference || (!difference.startsWith('..') && !isAbsolute(difference))))
    throw new AppError('INVALID_REQUEST', '请选择应用安装目录以外的模型与报告目录。')
  await mkdir(join(path, 'config'), { recursive: true })
  await mkdir(join(path, 'work'), { recursive: true })
  const templates = app.isPackaged
    ? join(process.resourcesPath, 'config-templates')
    : join(app.getAppPath(), 'config')
  for (const name of modelNames) {
    try {
      await copyFile(
        join(templates, `${name}.example.json`),
        join(path, 'config', `${name}.example.json`),
        constants.COPYFILE_EXCL
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  if (app.isPackaged) {
    try {
      await copyFile(
        join(process.resourcesPath, 'INSTALLATION.md'),
        join(path, '安装与模型配置说明.md'),
        constants.COPYFILE_EXCL
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  await mkdir(app.getPath('userData'), { recursive: true })
  const temporary = settingsPath() + '.tmp'
  await writeFile(temporary, JSON.stringify({ directory: path }, null, 2))
  await rename(temporary, settingsPath())
  beforeChange()
  applyDirectory(path)
  await startManagedOllama(path).catch(() => {})
  return runtimeEnvironment()
}
