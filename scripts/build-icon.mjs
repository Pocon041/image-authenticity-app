import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

const root = resolve(import.meta.dirname, '..')
const svg = await readFile(resolve(root, 'build/icon.svg'))
const sizes = [256, 128, 64, 48, 32, 16]
const frames = []
for (const size of sizes) {
  const rgba = await sharp(svg).resize(size, size).ensureAlpha().raw().toBuffer()
  const maskStride = Math.ceil(size / 32) * 4
  const frame = Buffer.alloc(40 + size * size * 4 + maskStride * size)
  frame.writeUInt32LE(40, 0)
  frame.writeInt32LE(size, 4)
  frame.writeInt32LE(size * 2, 8)
  frame.writeUInt16LE(1, 12)
  frame.writeUInt16LE(32, 14)
  frame.writeUInt32LE(size * size * 4, 20)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const input = (y * size + x) * 4
      const output = 40 + ((size - y - 1) * size + x) * 4
      frame[output] = rgba[input + 2]
      frame[output + 1] = rgba[input + 1]
      frame[output + 2] = rgba[input]
      frame[output + 3] = rgba[input + 3]
    }
  }
  frames.push(frame)
}
const header = Buffer.alloc(6 + sizes.length * 16)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
let offset = header.length
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16
  header[entry] = size === 256 ? 0 : size
  header[entry + 1] = size === 256 ? 0 : size
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(frames[index].length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += frames[index].length
}
await writeFile(resolve(root, 'build/icon.ico'), Buffer.concat([header, ...frames]))
console.log('Application icon generated from build/icon.svg')
