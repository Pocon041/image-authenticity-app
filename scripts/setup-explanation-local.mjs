import { access, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = process.argv.slice(2)
const value = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}

if (args.includes('--help') || args.includes('-h')) {
  console.log('用法：run.cmd run explanation:setup -- [--model <本地Ollama标签>] [--force]')
  console.log('默认标签：srdp-qwen3-vl-2b')
  process.exit(0)
}

const model = value('--model', 'srdp-qwen3-vl-2b')
if (!model || model.startsWith('-')) throw new Error('--model 必须是非空的 Ollama 本地模型标签。')

const localPath = join(root, 'config', 'explanation.local.json')
if (!args.includes('--force')) {
  try {
    await access(localPath)
    console.log(`已保留现有配置：${localPath}`)
    console.log('如需改成本地模型标签，请手动修改该文件，或使用 --force 重新生成。')
    process.exit(0)
  } catch {
    // The local config is optional and ignored by Git.
  }
}

const example = JSON.parse(
  (await readFile(join(root, 'config', 'explanation.example.json'), 'utf8')).replace(/^\uFEFF/, '')
)
example.model = model
example.host = 'http://127.0.0.1:11434'
delete example._comment
await writeFile(localPath, `${JSON.stringify(example, null, 2)}\n`, 'utf8')

console.log(`已生成本地解释配置：${localPath}`)
console.log(`模型标签：${model}`)
console.log('请确认该标签已经存在于 Ollama：ollama list')
console.log('如果 Ollama 尚未启动，请先运行：ollama serve')
console.log('此命令只写本机配置，不下载模型，也不会修改云端接口。')
