import json
import unittest
from read_c2pa import active_manifest_summary


class ReaderFixture:
    def __init__(self, state='Invalid', failure=None, source='trainedAlgorithmicMedia'):
        self.state = state
        self.store = {
            'active_manifest': 'active',
            'manifests': {'active': {
                'claim_generator_info': [{'name': 'Example Generator'}],
                'assertions': [{'label': 'c2pa.actions.v2', 'data': {'actions': [
                    {'action': 'c2pa.created', 'digitalSourceType': f'https://example.test/{source}'}
                ]}}]
            }},
            'validation_status': failure or [],
            'validation_results': {'activeManifest': {
                'success': [{'code': 'claimSignature.validated'}, {'code': 'assertion.dataHash.match'}],
                'failure': failure or [],
                'informational': []
            }}
        }

    def json(self):
        return json.dumps(self.store)

    def get_validation_state(self):
        return self.state


class C2paSummaryTests(unittest.TestCase):
    def test_top_level_errors_and_successful_integrity_are_preserved(self):
        issue = {'code': 'signingCredential.untrusted', 'explanation': 'certificate untrusted'}
        result = active_manifest_summary(ReaderFixture(failure=[issue]))
        self.assertEqual(result['validationStatus'], [issue])
        self.assertEqual(result['validationChecks']['claimSignature'], 'passed')
        self.assertEqual(result['validationChecks']['contentBinding'], 'passed')
        self.assertEqual(result['validationChecks']['signerTrust'], 'untrusted')
        self.assertEqual(result['validationState'], 'Invalid')
        self.assertEqual(result['aiDeclaration'], 'declared_ai_generated_or_composited')

    def test_binding_failure_wins_over_success(self):
        result = active_manifest_summary(ReaderFixture(failure=[{'code': 'assertion.dataHash.mismatch'}]))
        self.assertEqual(result['validationChecks']['contentBinding'], 'failed')

    def test_missing_verification_is_not_success(self):
        reader = ReaderFixture(state='Unknown')
        reader.store.pop('validation_results')
        self.assertEqual(active_manifest_summary(reader)['validationChecks']['claimSignature'], 'not_checked')

    def test_algorithmic_media_does_not_necessarily_declare_trained_ai(self):
        result = active_manifest_summary(ReaderFixture(source='algorithmicMedia'))
        self.assertEqual(result['aiDeclaration'], 'no_known_ai_source_type_in_active_actions')


if __name__ == '__main__':
    unittest.main()
