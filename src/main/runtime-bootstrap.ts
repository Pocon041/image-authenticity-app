import { app } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  writeFile
} from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import type { RuntimeSetupProgress, RuntimeSetupStatus } from '../shared/contracts'
import { startManagedOllama } from './managed-ollama'

interface Component {
  file: string
  directory: string
  bytes: number
  unpackedBytes: number
  sha256: string
}
interface Manifest {
  schemaVersion: number
  id: string
  components: Component[]
  unpackedBytes: number
  checkpoints: Record<string, { path: string; sha256: string; variant?: string }>
  ollamaPort: number
  ollamaModel: string
}
let setupController: AbortController | undefined
let lastProgress: RuntimeSetupProgress | undefined
let progressRoot: string | undefined

async function bundleDirectory(): Promise<string | null> {
  if (process.env.SRDP_BUNDLE_DIR) return resolve(process.env.SRDP_BUNDLE_DIR)
  try {
    const value = JSON.parse(
      await readFile(join(app.getPath('userData'), 'runtime-bundle-directory.json'), 'utf8')
    )
    if (typeof value.directory === 'string') return value.directory
  } catch {
    /* Use the installer-provided source directory. */
  }
  if (!app.isPackaged) return null
  try {
    return (await readFile(join(process.resourcesPath, 'bootstrap-source.txt'), 'utf16le'))
      .replace(/^\uFEFF/, '')
      .trim()
  } catch {
    return null
  }
}

export async function selectRuntimeBundle(directory: string): Promise<void> {
  const path = await realpath(directory)
  await manifestAt(path)
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(
    join(app.getPath('userData'), 'runtime-bundle-directory.json'),
    JSON.stringify({ directory: path })
  )
}

function childPath(parent: string, name: string): string {
  const path = resolve(parent, name)
  const difference = relative(resolve(parent), path)
  if (!difference || difference.startsWith('..') || isAbsolute(difference))
    throw new Error('安装资源中的文件路径无效。')
  return path
}

async function manifestAt(directory: string): Promise<Manifest> {
  const value = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as Manifest
  if (
    value.schemaVersion !== 1 ||
    !/^[a-z0-9.-]+$/.test(value.id) ||
    !Array.isArray(value.components) ||
    !value.components.length
  )
    throw new Error('完整环境资源清单无效。')
  for (const component of value.components) {
    childPath(directory, component.file)
    if (
      !/^[a-z0-9-]+$/.test(component.directory) ||
      !/^[a-f0-9]{64}$/.test(component.sha256) ||
      !Number.isSafeInteger(component.bytes)
    )
      throw new Error('完整环境资源条目无效。')
  }
  return value
}

export async function runtimeSetupStatus(root: string | null): Promise<RuntimeSetupStatus> {
  const bundle = await bundleDirectory()
  let available = false
  if (bundle) {
    try {
      await access(join(bundle, 'manifest.json'))
      available = true
    } catch {
      /* Bundle can be selected again. */
    }
  }
  let ready = false
  if (root) {
    try {
      const state = JSON.parse(await readFile(join(root, 'config/managed-runtime.json'), 'utf8'))
      await access(join(state.directory, 'ready.json'))
      ready = true
    } catch {
      /* A fresh directory has no managed environment. */
    }
  }
  return {
    available,
    ready,
    running: !!setupController,
    ...(root === progressRoot ? { progress: lastProgress } : {})
  }
}

export function cancelRuntimeSetup(): boolean {
  if (!setupController) return false
  setupController.abort()
  return true
}

async function command(
  command: string,
  args: string[],
  signal: AbortSignal,
  cwd: string
): Promise<string> {
  signal.throwIfAborted()
  const child = spawn(command, args, {
    cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      HF_HUB_OFFLINE: '1',
      TRANSFORMERS_OFFLINE: '1'
    }
  })
  let stdout = '',
    stderr = ''
  let outputOverflow = false
  child.stdout.on('data', (chunk) => {
    if (outputOverflow) return
    stdout += chunk.toString()
    if (stdout.length > 32 * 1024 * 1024) {
      outputOverflow = true
      child.kill()
    }
  })
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-4000)
  })
  const cancel = () => child.kill()
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  try {
    return await new Promise((accept, reject) => {
      child.once('error', reject)
      child.once('close', (code) => {
        if (signal.aborted) reject(new Error('自动配置已取消，可以继续重试。'))
        else if (outputOverflow) reject(new Error('环境准备命令返回的数据超出上限。'))
        else if (code !== 0) reject(new Error(`环境准备命令失败。${stderr || stdout.slice(-4000)}`))
        else accept(stdout)
      })
    })
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

async function hashFile(path: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    signal.throwIfAborted()
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function writeNew(path: string, data: unknown): Promise<void> {
  try {
    await writeFile(path, JSON.stringify(data, null, 2), { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

export async function prepareRuntime(
  root: string,
  notify: (progress: RuntimeSetupProgress) => void
): Promise<void> {
  if (setupController) throw new Error('自动配置正在执行。')
  const controller = new AbortController()
  setupController = controller
  progressRoot = root
  const signal = controller.signal
  const report = (
    stage: RuntimeSetupProgress['stage'],
    label: string,
    completed: number,
    total: number
  ) => {
    lastProgress = { stage, label, completed, total }
    notify(lastProgress)
  }
  try {
    const bundle = await bundleDirectory()
    if (!bundle)
      throw new Error('请使用团队完整分发包安装，或选择完整资源包中的 runtime-bundle 文件夹。')
    const manifest = await manifestAt(bundle)
    const base = join(root, '.runtime')
    const finalDirectory = childPath(base, manifest.id)
    const staging = childPath(join(base, '.staging'), manifest.id)
    const total = manifest.components.length + 5
    let ready = false
    try {
      await access(join(finalDirectory, 'ready.json'))
      ready = true
    } catch {
      /* Expand below. */
    }
    if (!ready) {
      const space = await statfs(root)
      if (space.bavail * space.bsize < manifest.unpackedBytes * 1.1)
        throw new Error(
          `所选磁盘空间不足，请预留至少 ${Math.ceil((manifest.unpackedBytes * 1.1) / 1024 ** 3)} GB。`
        )
      await mkdir(staging, { recursive: true })
      for (const [index, component] of manifest.components.entries()) {
        signal.throwIfAborted()
        const archive = childPath(bundle, component.file)
        const destination = childPath(staging, component.directory)
        const marker = join(staging, `${component.directory}.complete.json`)
        let complete = false
        try {
          complete = JSON.parse(await readFile(marker, 'utf8')).sha256 === component.sha256
        } catch {
          /* Verify resource. */
        }
        if (complete) continue
        report('verifying', `校验 ${component.directory} 资源`, index, total)
        if (
          (await stat(archive)).size !== component.bytes ||
          (await hashFile(archive, signal)) !== component.sha256
        )
          throw new Error(`资源 ${component.file} 不完整，请重新复制完整分发包。`)
        report('extracting', `展开 ${component.directory} 环境`, index, total)
        const listing = await command('tar.exe', ['-tf', archive], signal, root)
        for (const name of listing.split(/\r?\n/).filter(Boolean)) childPath(destination, name)
        // Only this app-owned component staging directory is reset after an interrupted extraction.
        if (!destination.startsWith(resolve(staging) + sep)) throw new Error('安装暂存目录无效。')
        await rm(destination, { recursive: true, force: true })
        await mkdir(destination, { recursive: true })
        await command('tar.exe', ['-xf', archive, '-C', destination], signal, root)
        await writeFile(marker, JSON.stringify({ sha256: component.sha256 }))
      }
      report('checking', '检查三个独立 Python 环境', manifest.components.length, total)
      const checks = [
        [
          'python-vision',
          'import torch,torchvision,timm,cv2,ftfy,einops;print(torch.cuda.is_available())'
        ],
        ['python-provenance', 'import c2pa,cv2,pywt;from rapidocr import RapidOCR;RapidOCR()'],
        ['python-fsd', 'import torch,scipy,sklearn,PIL']
      ]
      for (const [index, [directory, imports]] of checks.entries()) {
        report('checking', `检查 ${directory} 运行环境`, manifest.components.length + index, total)
        await command(join(staging, directory, 'python.exe'), ['-c', imports], signal, root)
      }
      await writeFile(
        join(staging, 'ready.json'),
        JSON.stringify({ id: manifest.id, preparedAt: new Date().toISOString() })
      )
      await rename(staging, finalDirectory)
    }
    report('checking', '生成本机模型配置', manifest.components.length + 3, total)
    const gpu =
      (
        await command(
          join(finalDirectory, 'python-vision/python.exe'),
          ['-c', 'import torch;print(torch.cuda.is_available())'],
          signal,
          root
        )
      ).trim() === 'True'
    const python = join(finalDirectory, 'python-vision/python.exe')
    const tools = join(finalDirectory, 'tools')
    const checkpoint = (name: string) => ({
      checkpointPath: join(finalDirectory, manifest.checkpoints[name].path),
      checkpointSha256: manifest.checkpoints[name].sha256
    })
    await mkdir(join(root, 'config'), { recursive: true })
    const configurations: Record<string, unknown> = {
      sica: {
        pythonPath: python,
        upstreamPath: join(tools, 'sica-upstream/model.py'),
        clipSourcePath: join(tools, 'openai-clip'),
        ...checkpoint('sica'),
        checkpointVariant: manifest.checkpoints.sica.variant ?? 'full',
        device: 'auto',
        threshold: 0.5,
        timeoutMs: 180000
      },
      rita: {
        pythonPath: python,
        upstreamPath: join(tools, 'rita-upstream/rita.py'),
        ...checkpoint('rita'),
        device: 'auto',
        maxSteps: 10,
        decisionThreshold: null,
        timeoutMs: 180000
      },
      rise: {
        pythonPath: python,
        sourcePath: join(tools, 'rise-official'),
        dependencyPath: join(tools, 'rise-deps-v5'),
        ...checkpoint('rise'),
        device: gpu ? 'cuda:0' : 'cpu',
        tileStride: 384,
        maxTiles: 128,
        timeoutMs: 600000
      },
      aigc: {
        pythonPath: join(finalDirectory, 'python-fsd/python.exe'),
        sourcePath: join(tools, 'fsd'),
        weightsPath: join(finalDirectory, 'models/fsd/v1.2.0'),
        device: 'auto',
        threshold: -2,
        attribution: false,
        timeoutMs: 900000
      },
      router: {
        pythonPath: python,
        clipSourcePath: join(tools, 'openai-clip'),
        ...checkpoint('sica'),
        checkpointVariant: manifest.checkpoints.sica.variant ?? 'full',
        device: 'auto',
        marginThreshold: 0.15,
        timeoutMs: 180000
      },
      provenance: { pythonPath: join(finalDirectory, 'python-provenance/python.exe') },
      explanation: {
        model: manifest.ollamaModel,
        host: `http://127.0.0.1:${manifest.ollamaPort}`,
        numCtx: 8192,
        numPredict: 1200,
        maxImages: 3
      }
    }
    for (const [name, value] of Object.entries(configurations))
      await writeNew(join(root, 'config', `${name}.local.json`), value)
    await writeFile(
      join(root, 'config/managed-runtime.json'),
      JSON.stringify({
        directory: finalDirectory,
        port: manifest.ollamaPort,
        model: manifest.ollamaModel
      })
    )
    signal.throwIfAborted()
    report('starting', '启动随包的本地解释服务', manifest.components.length + 4, total)
    await startManagedOllama(root)
    report(
      'completed',
      gpu ? '完整环境已就绪，使用 NVIDIA GPU 推理' : '完整环境已就绪，使用 CPU 推理',
      total,
      total
    )
  } catch (error) {
    report(
      signal.aborted ? 'cancelled' : 'failed',
      error instanceof Error ? error.message : String(error),
      0,
      0
    )
    throw error
  } finally {
    setupController = undefined
  }
}
