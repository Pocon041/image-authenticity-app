import assert from 'node:assert/strict'
import { textNearRegion, textContext } from '../src/main/services/region-text.ts'

const sms = { bboxXYWH: [466, 716, 128, 47] }
const smsReadings = [
  { recognizedText: '信用卡12月19日21:16存款', bboxXYWH: [80, 710, 627, 59], region: 'full_image' },
  { recognizedText: '12月19日周四18:50', bboxXYWH: [423, 559, 323, 37], region: 'full_image' },
  { recognizedText: '1日万ド12', bboxXYWH: [87, 747, 225, 21], region: 'bottom_left_crop' }
]
const smsRows = textNearRegion(smsReadings, sms, 1170, 1205)
assert.equal(smsRows.length, 1)
assert.equal(smsRows[0].relation, 'overlapping')
assert.equal(textContext(smsRows, '21:16'), '“信用卡12月19日21:16存款”中的“21:16”')
assert.equal(textContext(smsRows, '18:25'), '“信用卡12月19日21:16存款”所在行')

const receipt = { bboxXYWH: [570, 447, 161, 44] }
const receiptReadings = [
  { recognizedText: 'NO.00112', bboxXYWH: [340, 455, 146, 41], region: 'top_left_crop' },
  { recognizedText: 'NO.0011240720', bboxXYWH: [340, 456, 235, 38], region: 'full_image' },
  { recognizedText: '原价 369.00', bboxXYWH: [310, 720, 300, 40], region: 'full_image' }
]
const receiptRows = textNearRegion(receiptReadings, receipt, 1280, 1706)
assert.equal(receiptRows.length, 1)
assert.equal(receiptRows[0].relation, 'left_neighbor')
assert.equal(textContext(receiptRows), '“NO.0011240720”右侧的区域')
assert.ok(!JSON.stringify(receiptRows).includes('原价'))

const right = textNearRegion(
  [
    { recognizedText: 'right label', bboxXYWH: [40, 10, 20, 10] },
    { recognizedText: 'invalid', bboxXYWH: [Number.NaN, 10, 20, 10] },
    { recognizedText: 'outside', bboxXYWH: [95, 10, 20, 10] }
  ],
  { bboxXYWH: [20, 10, 15, 10] },
  100,
  100
)
assert.equal(right.length, 1)
assert.equal(right[0].relation, 'right_neighbor')
assert.equal(textContext(right), '“right label”左侧的区域')
assert.deepEqual(textNearRegion(undefined, sms, 1170, 1205), [])
assert.equal(textContext([]), null)
assert.equal(smsReadings.length, 3, 'Source OCR inventory remains unchanged')
console.log(
  'Region/OCR geometry: matching rows, near-touching boxes, duplicates, unrelated rows and quoted context passed.'
)
