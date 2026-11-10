import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const credential = spawnSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
})
const token = credential.stdout?.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9)
if (credential.status !== 0 || !token) throw new Error('GitHub credential is unavailable.')
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'SRDP-release-manager'
}
const api = 'https://api.github.com/repos/Pocon041/image-authenticity-app'
const request = async (url, options = {}) => {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers ?? {}) } })
  const text = await response.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${url} returned HTTP ${response.status}: ${JSON.stringify(body)}`)
  return body
}

const old = await request(`${api}/releases/tags/v0.2.1`).catch(error => {
  if (/HTTP 404/.test(error.message)) return null
  throw error
})
if (old) await request(`${api}/releases/${old.id}`, { method: 'DELETE' })
const tag = await fetch(`${api}/git/ref/tags/v0.2.1`, { headers })
if (tag.ok) await request(`${api}/git/refs/tags/v0.2.1`, { method: 'DELETE' })

const body = [
  '## SRDP v0.2.2',
  '',
  'Windows x64 安装包，面向开发者使用。安装包提供桌面应用和本项目后端脚本。真实模型运行需要按 README 准备 Python、模型源码、官方权重和本地 Ollama。',
  '',
  '本版本更新了公开 README、硬件要求、模型配置说明和安装目录管理。完整报告与模型结果保存在用户选择的外部目录。',
  '',
  '安装包未配置代码签名证书，Windows 可能显示未知发布者。请核对 SHA256SUMS.txt。'
].join('\n')
const release = await request(`${api}/releases`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tag_name: 'v0.2.2', target_commitish: 'main', name: 'SRDP v0.2.2', body, draft: false, prerelease: false })
})
const directory = join(root, 'dist/v0.2.2')
const names = ['SRDP-Setup-0.2.2-x64.exe', 'SHA256SUMS.txt', 'SRDP-Setup-0.2.2-x64.exe.blockmap']
const assets = []
for (const name of names) {
  const path = join(directory, name)
  const size = (await stat(path)).size
  const uploadUrl = release.upload_url.replace(/\{.*$/, '') + `?name=${encodeURIComponent(name)}`
  const asset = await request(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Type': name.endsWith('.exe') ? 'application/octet-stream' : 'text/plain',
      'Content-Length': String(size)
    },
    body: createReadStream(path),
    duplex: 'half'
  })
  assets.push({ name: asset.name, size: asset.size, url: asset.browser_download_url })
}
console.log(JSON.stringify({ oldReleaseRemoved: !!old, release: release.html_url, assets }, null, 2))
