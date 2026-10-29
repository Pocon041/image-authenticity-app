import importlib.metadata
import json
import re
import sys
from collections.abc import Mapping
from typing import Any

from c2pa import Context, Reader
from PIL import ExifTags, Image


AI_SOURCE_TYPES = {
    'trainedAlgorithmicMedia',
    'compositeWithTrainedAlgorithmicMedia',
    'algorithmicMedia',
}


def active_manifest_summary(reader):
    store = json.loads(reader.json())
    manifests = store.get('manifests') or {}
    active_label = store.get('active_manifest')
    manifest = manifests.get(active_label) or {}
    actions = []
    for assertion in manifest.get('assertions') or []:
        label = assertion.get('label', '')
        if not label.startswith('c2pa.actions'):
            continue
        data = assertion.get('data') or {}
        for action in data.get('actions') or []:
            source_type = action.get('digitalSourceType')
            actions.append({
                'action': action.get('action'),
                'digitalSourceType': source_type,
                'softwareAgent': action.get('softwareAgent'),
                'when': action.get('when'),
            })

    source_types = [item['digitalSourceType'] for item in actions if item.get('digitalSourceType')]
    ai_declared = any(
        source_type.rsplit('/', 1)[-1] in AI_SOURCE_TYPES
        for source_type in source_types
    )
    if ai_declared:
        ai_declaration = 'declared_ai_generated_or_composited'
    elif source_types:
        ai_declaration = 'no_known_ai_source_type_in_active_actions'
    else:
        ai_declaration = 'no_source_type_disclosed_in_active_actions'

    signature = manifest.get('signature_info') or {}
    return {
        'activeManifest': active_label,
        'claimGenerator': manifest.get('claim_generator'),
        'claimGeneratorInfo': manifest.get('claim_generator_info') or [],
        'title': manifest.get('title'),
        'signature': {
            'algorithm': signature.get('alg'),
            'issuer': signature.get('issuer'),
            'time': signature.get('time'),
        },
        'validationState': str(reader.get_validation_state()),
        'validationStatus': manifest.get('validation_status') or [],
        'aiDeclaration': ai_declaration,
        'actions': actions[:64],
        'ingredients': [
            {
                'title': item.get('title'),
                'relationship': item.get('relationship'),
                'format': item.get('format'),
                'validationStatus': item.get('validation_status') or [],
            }
            for item in (manifest.get('ingredients') or [])[:64]
        ],
    }


def json_value(value):
    if isinstance(value, bytes):
        return value.decode('utf-8', errors='replace').strip('\x00 ')
    if isinstance(value, (tuple, list)):
        return [json_value(part) for part in value]
    if hasattr(value, 'numerator') and hasattr(value, 'denominator'):
        try:
            return float(value)
        except Exception:
            return str(value)
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return str(value)


def rational(value):
    try:
        return float(value)
    except Exception:
        return None


def gps_coordinate(values, reference):
    if not values or len(values) < 3:
        return None
    degrees, minutes, seconds = [rational(value) for value in values[:3]]
    if degrees is None or minutes is None or seconds is None:
        return None
    result = degrees + minutes / 60 + seconds / 3600
    return -result if str(reference).upper() in ('S', 'W') else result


def read_metadata(path):
    with Image.open(path) as image:
        exif = image.getexif()
        wanted = {
            'Make', 'Model', 'DateTime', 'DateTimeOriginal', 'DateTimeDigitized',
            'OffsetTime', 'OffsetTimeOriginal', 'Software', 'Artist', 'Copyright',
            'HostComputer', 'LensMake', 'LensModel', 'ExposureTime', 'FNumber',
            'ISOSpeedRatings', 'FocalLength'
        }
        exif_fields = {}
        exif_groups: list[Mapping[int, Any]] = [exif]
        if 34665 in exif:
            exif_groups.append(exif.get_ifd(34665))
        for group in exif_groups:
            for tag, value in group.items():
                name = ExifTags.TAGS.get(tag, str(tag))
                if name in wanted:
                    exif_fields[name] = json_value(value)
        gps = exif.get_ifd(34853) if 34853 in exif else {}
        gps_fields = {}
        if gps:
            latitude = gps_coordinate(gps.get(2), gps.get(1))
            longitude = gps_coordinate(gps.get(4), gps.get(3))
            if latitude is not None:
                gps_fields['latitude'] = latitude
            if longitude is not None:
                gps_fields['longitude'] = longitude
            if 6 in gps:
                altitude = rational(gps[6])
                if altitude is not None:
                    gps_fields['altitudeMeters'] = -altitude if gps.get(5) == 1 else altitude
            if 29 in gps:
                gps_fields['dateStamp'] = json_value(gps[29])
            if 7 in gps:
                gps_fields['timeStamp'] = json_value(gps[7])

        xmp_data = image.info.get('xmp')
        if isinstance(xmp_data, bytes):
            xmp_data = xmp_data.decode('utf-8', errors='replace')
        if not isinstance(xmp_data, str):
            xmp_data = ''
        xmp_fields = {}
        xmp_names = (
            'tiff:Make', 'tiff:Model', 'xmp:CreateDate', 'xmp:ModifyDate',
            'xmp:MetadataDate', 'xmp:CreatorTool', 'exif:DateTimeOriginal',
            'photoshop:DateCreated', 'photoshop:Credit', 'dc:rights',
            'dc:description', 'dc:title', 'Iptc4xmpCore:Location'
        )
        bounded_xmp = xmp_data[:1_000_000]
        for name in xmp_names:
            escaped = re.escape(name)
            match = re.search(rf'\b{escaped}\s*=\s*["\']([^"\']*)', bounded_xmp)
            if match is None:
                local_name = re.escape(name.split(':', 1)[-1])
                match = re.search(
                    rf'<(?:[\w.-]+:)?{local_name}\b[^>]*>(.*?)</(?:[\w.-]+:)?{local_name}\s*>',
                    bounded_xmp,
                    re.DOTALL
                )
            if match is not None:
                xmp_fields[name] = match.group(1).strip()[:2048]

        return {
            'format': image.format,
            'dimensions': list(image.size),
            'exif': exif_fields,
            'gps': gps_fields,
            'xmp': xmp_fields,
            'metadataPresence': {
                'exif': bool(exif),
                'gps': bool(gps_fields),
                'xmp': bool(xmp_data),
                'iptc': bool(image.info.get('photoshop')),
            },
            'strippingAssessment': 'unknown',
        }


def main(path, read_c2pa):
    metadata = read_metadata(path)
    response = {
        'ok': True,
        'pythonVersion': sys.version.split()[0],
        'pillowVersion': importlib.metadata.version('Pillow'),
        'metadata': metadata,
        'c2pa': None,
    }
    if read_c2pa:
        try:
            response['c2pa'] = read_c2pa_manifest(path)
        except Exception as error:
            response['c2pa'] = {
                'status': 'failed',
                'errorType': type(error).__name__,
                'reason': str(error)[:1000],
            }
    print(json.dumps(response, ensure_ascii=False))


def read_c2pa_manifest(path):
    settings = {
        'verify': {
            'verify_after_reading': True,
            'verify_trust': True,
            'verify_timestamp_trust': True,
            'ocsp_fetch': False,
            'remote_manifest_fetch': False,
        }
    }
    with Context.from_dict(settings) as context:
        with Reader(path, context=context) as reader:
            return {
                'status': 'completed',
                'sdkVersion': importlib.metadata.version('c2pa-python'),
                **active_manifest_summary(reader),
            }


if __name__ == '__main__':
    try:
        if len(sys.argv) not in (2, 3):
            raise ValueError('Usage: read_c2pa.py <image-path> [--read-c2pa]')
        main(sys.argv[1], len(sys.argv) == 3 and sys.argv[2] == '--read-c2pa')
    except Exception as error:
        print(json.dumps({
            'ok': False,
            'errorType': type(error).__name__,
            'error': str(error)[:1000],
        }, ensure_ascii=False))
        sys.exit(2)
