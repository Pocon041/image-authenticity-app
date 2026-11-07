import assert from 'node:assert/strict'
import {
  provenanceForVlm,
  provenanceNarrationFacts
} from '../src/main/services/provenance-input.ts'

const report = {
  status: 'completed',
  result: {
    preprocessing: { originalPreserved: true, displayTransform: 'exif_auto_orient_no_resize' },
    metadata: {
      status: 'completed',
      details: { format: 'png', exif: { Software: 'Example Editor' } }
    },
    credentials: {
      status: 'completed',
      details: {
        outcome: 'manifest_container_found',
        reader: {
          status: 'completed',
          claimGeneratorInfo: [{ name: 'Example Generator' }],
          signature: { issuer: 'Example Issuer' },
          aiDeclaration: 'declared_ai_generated_or_composited',
          actions: [
            {
              action: 'c2pa.created',
              digitalSourceType:
                'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
              softwareAgent: { name: 'Example App', version: '1.0' }
            }
          ],
          validationState: 'Invalid',
          validationStatus: [{ code: 'signingCredential.untrusted' }],
          validationChecks: {
            claimSignature: 'passed',
            contentBinding: 'passed',
            signerTrust: 'untrusted'
          }
        }
      }
    },
    watermark: {
      status: 'completed',
      details: {
        combinedOutcome: 'candidate_watermark_indicators_found',
        detectors: {
          metadata: { status: 'completed', outcome: 'no_known_markers_found' },
          visible: {
            status: 'completed',
            outcome: 'candidate_visible_text_found',
            recognizedTexts: [
              { recognizedText: 'ordinary body text must stay in the full report' }
            ],
            candidates: [
              {
                recognizedText: 'Adobe Stock',
                bboxXYWH: [4, 5, 80, 20],
                ruleEvidence: ['keyword_match']
              }
            ]
          },
          invisible: { status: 'not_run', outcome: 'not_scanned_image_over_resource_limit' }
        }
      }
    }
  }
}
const input = provenanceForVlm(report)
assert.equal(input.metadata.creatorTool, 'Example Editor')
assert.equal(input.credentials.claimGenerator, 'Example Generator')
assert.equal(input.credentials.aiDeclaration, 'declared_ai_generated_or_composited')
assert.equal(input.credentials.actions[0].softwareAgent, 'Example App')
assert.equal(input.credentials.actions[0].digitalSourceType, 'trainedAlgorithmicMedia')
assert.deepEqual(input.credentials.validation, {
  claimSignature: 'passed',
  contentBinding: 'passed',
  signerTrust: 'untrusted'
})
assert.equal(input.credentials.verification, '签名和文件绑定通过；本地证书检查未全部通过')
assert.equal(input.watermark.visibleCandidates[0].text, 'Adobe Stock')
assert.ok(input.unavailableChecks.includes('invisible_watermark'))
assert.ok(!JSON.stringify(input).includes('ordinary body text'))
assert.ok(!JSON.stringify(input).includes('not_run'))
assert.ok(!JSON.stringify(input).includes('null'))
const facts = provenanceNarrationFacts(input).join('\n')
assert.match(facts, /Example Generator/)
assert.match(facts, /Example App\/1.0/)
assert.match(facts, /声明使用了AI/)
assert.match(facts, /Adobe Stock/)
assert.match(facts, /本地证书检查未全部通过/)
report.result.credentials.details.reader.validationState = 'Trusted'
assert.match(provenanceNarrationFacts(provenanceForVlm(report)).join('\n'), /本地凭证验证通过/)
report.result.watermark.details.detectors.visible.status = 'failed'
assert.ok(provenanceForVlm(report).unavailableChecks.includes('visible_watermark'))
assert.deepEqual(provenanceForVlm(undefined), {})
assert.deepEqual(
  provenanceForVlm({
    status: 'completed',
    result: {
      metadata: { status: 'completed', details: { format: 'png', hasExif: false } },
      credentials: { status: 'completed', details: { outcome: 'no_manifest_container_found' } },
      watermark: {
        status: 'completed',
        details: { combinedOutcome: 'no_known_watermark_indicators_found' }
      }
    }
  }),
  {}
)
assert.deepEqual(provenanceNarrationFacts(provenanceForVlm(undefined)), [])
const invalidBinding = structuredClone(report)
invalidBinding.result.credentials.details.reader.validationState = 'Invalid'
invalidBinding.result.credentials.details.reader.validationChecks.contentBinding = 'failed'
assert.equal(provenanceForVlm(invalidBinding).credentials.validation.contentBinding, 'failed')
assert.equal(provenanceForVlm(invalidBinding).credentials.verification, '文件内容绑定未通过')
const readerFailed = structuredClone(report)
readerFailed.result.credentials.details.reader.status = 'failed'
assert.equal(provenanceForVlm(readerFailed).credentials, undefined)
assert.ok(provenanceForVlm(readerFailed).unavailableChecks.includes('credentials'))
console.log(
  'Provenance VLM input: source declarations, basic validation, watermark details and unavailable states passed.'
)
