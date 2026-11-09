"""Build the developer installer and a GitHub-sized, executable offline installer."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def compile_bootstrap(root, manifest_path, output, version):
    candidates = sorted((root / '.tools/electron-builder-cache').rglob('makensis.exe'), key=lambda path: len(str(path)))
    if not candidates:
        raise RuntimeError('Build package:win first to prepare the NSIS compiler.')
    helper = manifest_path.parent / 'prepare-full.ps1'
    helper.write_text((root / 'scripts/install-full.ps1').read_text(encoding='utf-8'), encoding='utf-8-sig')
    command = [str(candidates[0]), '/INPUTCHARSET', 'UTF8',
               f'/DVERSION={version}', f'/DOUTPUT_FILE={output}',
               f'/DHELPER={helper}', f'/DMANIFEST={manifest_path}', f'/DAPP_ICON={root / "build/icon.ico"}',
               str(root / 'build/full-installer.nsi')]
    subprocess.run(command, cwd=root, check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime', type=Path)
    parser.add_argument('--installer', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--part-mib', type=int, default=1800)
    parser.add_argument('--skip-bootstrap', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
    version_root = root / 'dist' / f'v{version}'
    runtime = (args.runtime or root / 'dist/research-runtime-v1/runtime-bundle').resolve()
    installer = (args.installer or version_root / f'SRDP-Setup-{version}-x64.exe').resolve()
    output = (args.output or version_root / 'release').resolve()
    output.mkdir(parents=True, exist_ok=True)
    work = root / 'work' / f'release-v{version}'
    work.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((runtime / 'manifest.json').read_text(encoding='utf-8'))
    if not 1 <= args.part_mib < 2048:
        raise ValueError('Release data parts must be smaller than 2 GiB.')
    for component in manifest['components']:
        path = runtime / component['file']
        if path.stat().st_size != component['bytes'] or digest(path) != component['sha256']:
            raise ValueError(f'Runtime component integrity check failed: {path.name}')
        print(f'Runtime verified: {path.name}', flush=True)
    developer = output / f'SRDP-Developer-Setup-{version}-x64.exe'
    shutil.copy2(installer, developer)
    notices = root / 'docs/THIRD_PARTY_COMPONENTS.md'
    files = [(installer, installer.name), (runtime / 'manifest.json', 'runtime-bundle/manifest.json')]
    files += [(runtime / component['file'], f"runtime-bundle/{component['file']}") for component in manifest['components']]
    if notices.exists():
        files.append((notices, 'THIRD_PARTY_COMPONENTS.md'))
    archive = version_root / f'SRDP-Full-{version}-payload.zip'
    print(f'Preparing offline payload: {archive}', flush=True)
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as stream:
        for path, name in files:
            stream.write(path, name)
    parts = []
    part_size = args.part_mib * 1024 * 1024
    full_hash = hashlib.sha256()
    with archive.open('rb') as source:
        index = 1
        while source.tell() < archive.stat().st_size:
            name = f'SRDP-Full-Data-{version}-{index:02d}.bin'
            path = output / name
            part_hash = hashlib.sha256()
            remaining = part_size
            with path.open('wb') as target:
                while remaining:
                    block = source.read(min(8 * 1024 * 1024, remaining))
                    if not block:
                        break
                    target.write(block)
                    full_hash.update(block)
                    part_hash.update(block)
                    remaining -= len(block)
            parts.append({'name': name, 'bytes': path.stat().st_size, 'sha256': part_hash.hexdigest()})
            print(f'Offline data ready: {name} ({path.stat().st_size} bytes)', flush=True)
            index += 1
    distribution = {
        'schemaVersion': 1, 'version': version, 'installer': installer.name,
        'archiveSha256': full_hash.hexdigest(), 'archiveBytes': archive.stat().st_size,
        'expandedBytes': sum(path.stat().st_size for path, _ in files), 'parts': parts,
        'runtimeId': manifest['id'], 'runtimeUnpackedBytes': manifest['unpackedBytes']
    }
    manifest_path = work / 'distribution.json'
    manifest_path.write_text(json.dumps(distribution, indent=2), encoding='utf-8')
    full = output / f'SRDP-Full-Setup-{version}-x64.exe'
    if not args.skip_bootstrap:
        compile_bootstrap(root, manifest_path, full, version)
    artifacts = [developer] + ([full] if full.exists() else []) + [output / item['name'] for item in parts]
    metadata = {'version': version, 'platform': 'windows-x64', 'artifacts': [
        {'name': path.name, 'bytes': path.stat().st_size, 'sha256': digest(path)} for path in artifacts
    ]}
    downloads = output / f'SRDP-Downloads-{version}.json'
    downloads.write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    rows = [f"{item['sha256']}  {item['name']}" for item in metadata['artifacts']]
    rows.append(f'{digest(downloads)}  {downloads.name}')
    (output / 'SHA256SUMS.txt').write_text('\n'.join(rows) + '\n', encoding='utf-8')
    print(json.dumps({'output': str(output), 'parts': len(parts), 'payloadBytes': archive.stat().st_size}), flush=True)


if __name__ == '__main__':
    main()
