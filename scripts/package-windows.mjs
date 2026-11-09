import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directoryOnly = process.argv.includes('--dir')
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const output = join(root, 'dist', `v${version}`)
const cache = join(root, '.tools', 'electron-builder-cache')
await mkdir(cache, { recursive: true })
const builder = spawn(
  process.execPath,
  [
    join(root, 'node_modules/electron-builder/cli.js'),
    '--win',
    ...(directoryOnly ? ['--dir'] : ['nsis', '--x64']),
    '--publish',
    'never'
  ],
  {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, ELECTRON_BUILDER_CACHE: cache }
  }
)
const code = await new Promise((resolveCode, reject) => {
  builder.once('error', reject)
  builder.once('exit', resolveCode)
})
if (code !== 0) process.exit(typeof code === 'number' ? code : 1)
if (!directoryOnly) {
  const name = `SRDP-Setup-${version}-x64.exe`
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(join(output, name))) hash.update(chunk)
  await writeFile(join(output, 'SHA256SUMS.txt'), `${hash.digest('hex')}  ${name}\n`)
  console.log(`Installer and SHA256SUMS.txt saved in ${output}`)
}
