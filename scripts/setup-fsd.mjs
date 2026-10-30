// [第三人任务] 固定 FSD 上游提交并准备隔离运行环境。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(readFileSync(join(root, 'backend/aigc/source-lock.json'), 'utf8'))
const source = join(root, '.tools/fsd')
const venv = join(root, '.venv-fsd')
const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'git' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (!existsSync(join(source, '.git'))) {
  mkdirSync(join(root, '.tools'), { recursive: true })
  run('git', ['clone', '--filter=blob:none', '--no-checkout', lock.repository, source])
}
const current = spawnSync('git', ['-C', source, 'rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
if (current.status !== 0 || current.stdout.trim() !== lock.commit)
  run('git', ['-C', source, 'fetch', 'origin', lock.commit, '--depth=1'])
run('git', ['-C', source, 'checkout', '--detach', lock.commit])
let python = 'py'
let prefix = ['-3.12']
let py = spawnSync(python, [...prefix, '--version'], { cwd: root, encoding: 'utf8' })
if (py.status !== 0) {
  python = 'python'
  prefix = []
  py = spawnSync(python, ['--version'], { cwd: root, encoding: 'utf8' })
}
const version = `${py.stdout ?? ''} ${py.stderr ?? ''}`.match(/Python\s+(\d+)\.(\d+)/)
if (py.status !== 0 || !version || Number(version[1]) < 3 || (Number(version[1]) === 3 && Number(version[2]) < 12)) {
  console.error('FSD 需要 Python 3.12 或更高版本。请安装后重开终端，再运行此命令。')
  process.exit(2)
}
if (!existsSync(join(venv, 'Scripts/python.exe'))) run(python, [...prefix, '-m', 'venv', venv])
run(join(venv, 'Scripts/python.exe'), ['-m', 'pip', 'install', '--upgrade', 'pip'])
// 上游 pyproject 包含 Ray/Gradio 服务依赖；桌面单图仅需推理依赖，避免安装无关服务。
run(join(venv, 'Scripts/python.exe'), ['-m', 'pip', 'install', 'torch>=2.10.0', 'scipy>=1.17.0', 'pillow>=12.1.0', 'scikit-learn>=1.8.0'])
run(join(venv, 'Scripts/python.exe'), ['-m', 'pip', 'install', '--no-deps', source])
const config = { pythonPath: '.venv-fsd/Scripts/python.exe', sourcePath: '.tools/fsd', device: 'auto', threshold: -2, attribution: false, timeoutMs: 300000 }
const configPath = join(root, 'config/aigc.local.json')
if (!existsSync(configPath)) writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
console.log('FSD 环境已准备。权重将在首次检测时从上游 v1.2.0 release 下载并缓存。')
