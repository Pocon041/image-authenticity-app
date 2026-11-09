"""Build the private, offline runtime bundle from verified local research assets."""
import argparse
import hashlib
import importlib.metadata as metadata
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import zipfile

from packaging.requirements import Requirement


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def copy_file(source, destination):
    source, destination = Path(source), Path(destination)
    if destination.exists():
        previous, current = destination.stat(), source.stat()
        if previous.st_size == current.st_size and previous.st_mtime_ns == current.st_mtime_ns:
            return str(destination)
    return shutil.copy2(source, destination)


def copy_tree(source, destination):
    shutil.copytree(source, destination, dirs_exist_ok=True,
                    copy_function=copy_file,
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.pdb', '.git', 'test', 'tests'))


def pe_imports(path):
    data = path.read_bytes()
    if data[:2] != b'MZ':
        return []
    pe = struct.unpack_from('<I', data, 60)[0]
    sections = struct.unpack_from('<H', data, pe + 6)[0]
    optional = pe + 24
    optional_size = struct.unpack_from('<H', data, pe + 20)[0]
    directory = optional + (112 if struct.unpack_from('<H', data, optional)[0] == 0x20b else 96)
    imports = struct.unpack_from('<I', data, directory + 8)[0]
    if not imports:
        return []
    ranges = [struct.unpack_from('<IIII', data, optional + optional_size + i * 40 + 8)
              for i in range(sections)]

    def offset(rva):
        for virtual_size, address, raw_size, raw_offset in ranges:
            if address <= rva < address + max(virtual_size, raw_size):
                return raw_offset + rva - address
        raise ValueError(f'Invalid import address in {path.name}')

    cursor = offset(imports)
    names = []
    while any(data[cursor:cursor + 20]):
        name = offset(struct.unpack_from('<I', data, cursor + 12)[0])
        names.append(data[name:data.index(b'\0', name)].decode('ascii').lower())
        cursor += 20
    return names


def copy_python(base, destination):
    destination.mkdir(parents=True, exist_ok=True)
    for pattern in ('python*.exe', '*.dll', 'LICENSE*'):
        for source in base.glob(pattern):
            copy_file(source, destination / source.name)
    copy_tree(base / 'DLLs', destination / 'DLLs')
    shutil.copytree(base / 'Lib', destination / 'Lib', dirs_exist_ok=True, copy_function=copy_file,
                    ignore=shutil.ignore_patterns('site-packages', '__pycache__', '*.pyc', 'test', 'tests', 'idlelib'))
    search = {}
    for directory in (base, base / 'DLLs', base / 'Library/bin'):
        for path in directory.glob('*.dll'):
            search.setdefault(path.name.lower(), path)
    pending = list(destination.glob('*.dll')) + list(destination.glob('python*.exe')) + list((destination / 'DLLs').glob('*.pyd'))
    visited = set()
    while pending:
        file = pending.pop()
        if file.name.lower() in visited:
            continue
        visited.add(file.name.lower())
        for name in pe_imports(file):
            source = search.get(name)
            if source is None:
                continue
            target = destination / source.name
            if not target.exists():
                copy_file(source, target)
            pending.append(target)
    site = destination / 'Lib/site-packages'
    site.mkdir(parents=True, exist_ok=True)
    (site / 'sitecustomize.py').write_text(
        "import os,sys\n_dll_handles=[]\nif os.name=='nt':\n"
        "    for _directory in (sys.prefix,os.path.join(sys.prefix,'Library','bin')):\n"
        "        if os.path.isdir(_directory): _dll_handles.append(os.add_dll_directory(_directory))\n",
        encoding='utf-8')


def copy_visual_packages(destination):
    roots = ['torch', 'torchvision', 'timm', 'numpy', 'Pillow', 'opencv-python',
             'ftfy', 'regex', 'tqdm', 'safetensors', 'huggingface-hub', 'requests',
             'packaging', 'PyYAML', 'einops']
    selected = {}
    pending = list(roots)
    package_roots = set()
    while pending:
        name = pending.pop()
        distribution = metadata.distribution(name)
        canonical = distribution.metadata['Name'].lower().replace('_', '-')
        if canonical in selected:
            continue
        selected[canonical] = distribution.version
        for file in distribution.files or []:
            if file.parts and file.parts[0] != '..':
                package_roots.add(Path(distribution.locate_file(file.parts[0])))
        for value in distribution.requires or []:
            requirement = Requirement(value)
            if requirement.marker is None or requirement.marker.evaluate({'extra': ''}):
                pending.append(requirement.name)
    destination.mkdir(parents=True, exist_ok=True)
    for source in sorted(package_roots):
        if source.is_dir():
            copy_tree(source, destination / source.name)
        elif source.is_file():
            shutil.copy2(source, destination / source.name)
    return selected


def portable_venv(source, destination):
    configuration = dict(line.split(' = ', 1) for line in (source / 'pyvenv.cfg').read_text().splitlines() if ' = ' in line)
    copy_python(Path(configuration['home']), destination)
    copy_tree(source / 'Lib/site-packages', destination / 'Lib/site-packages')


def copy_tools(root, destination):
    destination.mkdir(parents=True, exist_ok=True)
    for relative in ('rita-upstream/rita.py', 'sica-upstream/model.py'):
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / '.tools' / relative, target)
    clip = root / '.tools/openai-clip'
    manifest = json.loads((clip / 'srdp-source-manifest.json').read_text())
    for relative in list(manifest['files']) + ['srdp-source-manifest.json', 'LICENSE']:
        target = destination / 'openai-clip' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(clip / relative, target)
    rise = root / '.tools/rise-official'
    lock = json.loads((root / 'backend/rise/source-lock.json').read_text())
    for relative in list(lock['files']) + ['LICENSE']:
        target = destination / 'rise-official' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(rise / relative, target)
    copy_tree(root / '.tools/rise-deps-v5', destination / 'rise-deps-v5')
    copy_tree(root / '.tools/fsd/fsd', destination / 'fsd/fsd')
    shutil.copy2(root / '.tools/fsd/LICENSE', destination / 'fsd/LICENSE')


def copy_models(root, destination):
    checkpoints = {}
    for model in ('sica', 'rita', 'rise'):
        config = json.loads((root / f'config/{model}.local.json').read_text(encoding='utf-8-sig'))
        source = root / config['checkpointPath']
        target = destination / model / source.name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        value = digest(target)
        if config.get('checkpointSha256') and value != config['checkpointSha256']:
            raise ValueError(f'{model} checkpoint checksum mismatch')
        checkpoints[model] = {'path': f'models/{model}/{target.name}', 'sha256': value,
                              'variant': config.get('checkpointVariant')}
    fsd = destination / 'fsd/v1.2.0'
    fsd.mkdir(parents=True, exist_ok=True)
    for name in ('config.json', 'fre.pt', 'gmm.pt', 'fsd_transforms.pt'):
        shutil.copy2(root / 'weights/fsd/v1.2.0' / name, fsd / name)
    blobs = root / 'weights/ollama-models/blobs'
    manifests = []
    for file in blobs.iterdir():
        if file.stat().st_size > 4096:
            continue
        try:
            value = json.loads(file.read_text())
            if isinstance(value, dict) and value.get('layers') and any('2B-Instruct' in layer.get('from', '') for layer in value['layers']):
                manifests.append(value)
        except (UnicodeError, ValueError):
            pass
    if len(manifests) != 1:
        raise ValueError('Expected one local Qwen3-VL-2B-Instruct model manifest')
    manifest = manifests[0]
    store = destination / 'ollama-models'
    (store / 'blobs').mkdir(parents=True, exist_ok=True)
    for entry in [manifest['config']] + manifest['layers']:
        name = entry['digest'].replace(':', '-')
        shutil.copy2(blobs / name, store / 'blobs' / name)
        if digest(store / 'blobs' / name) != entry['digest'].split(':')[1]:
            raise ValueError('Ollama blob checksum mismatch')
    target = store / 'manifests/registry.ollama.ai/library/srdp-qwen3-vl-2b/latest'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(manifest), encoding='utf-8')
    return checkpoints


def archive_component(source, output, name):
    archive = output / f'{name}.zip'
    files = [path for path in source.rglob('*') if path.is_file()]
    size = sum(path.stat().st_size for path in files)
    print(f'ARCHIVE {name}: {len(files)} files, {size / 1024 ** 3:.2f} GiB', flush=True)
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as stream:
        for file in files:
            stream.write(file, file.relative_to(source).as_posix())
    return {'file': archive.name, 'directory': name, 'bytes': archive.stat().st_size,
            'unpackedBytes': size, 'sha256': digest(archive)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path)
    parser.add_argument('--assemble-only', action='store_true')
    args = parser.parse_args()
    root = args.root.resolve()
    output = (args.output or root / 'dist/research-runtime-v1/runtime-bundle').resolve()
    stage = root / 'work/research-runtime-v1'
    output.mkdir(parents=True, exist_ok=True)
    if args.assemble_only:
        manifest_path = output / 'manifest.json'
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        identifier = hashlib.sha256(''.join(item['sha256'] for item in manifest['components']).encode()).hexdigest()[:12]
        manifest['id'] = f'research-v1-{identifier}'
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
        installer_name = f'SRDP-Setup-{version}-x64.exe'
        installer = root / 'dist' / f'v{version}' / installer_name
        shutil.copy2(installer, output.parent / installer_name)
        instructions = output.parent / '使用说明.txt'
        instructions.write_text(
            f'SRDP {version} 内部科研完整包\n\n'
            f'1. 将本压缩包完整解压到数据盘，保持 {installer_name} 与 runtime-bundle 在同一个目录。\n'
            f'2. 运行 {installer_name} 完成应用安装。\n'
            '3. 首次打开应用后，点击“选择数据目录并自动配置”，选择空间充足的新数据文件夹并等待完成。\n'
            '程序自动展开Python、检测权重和本地解释服务，不需要用户另行下载或安装这些组件。\n'
            '配置完成后可以删除分发包的解压目录，建议保留原始ZIP以便重装。\n'
            '更新和卸载应用会保留数据目录。\n\n'
            '本包仅供内部非商业科研使用，第三方组件的许可与来源保存在资源包中。\n', encoding='utf-8-sig')
        files = [output.parent / installer_name, instructions, manifest_path] + [output / item['file'] for item in manifest['components']]
        checksums = output.parent / 'SHA256SUMS.txt'
        checksums.write_text('\n'.join(f'{digest(file)}  {file.relative_to(output.parent).as_posix()}' for file in files) + '\n', encoding='utf-8')
        files.append(checksums)
        archive = root / 'dist' / f'SRDP-Research-{version}-win-x64.zip'
        print(f'Assembling internal distribution {archive}', flush=True)
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as stream:
            for file in files:
                stream.write(file, file.relative_to(output.parent).as_posix())
        (archive.with_suffix('.zip.sha256')).write_text(f'{digest(archive)}  {archive.name}\n', encoding='utf-8')
        print(json.dumps({'archive': str(archive), 'bytes': archive.stat().st_size}), flush=True)
        return
    stage.mkdir(parents=True, exist_ok=True)
    components = []
    print('Preparing portable Python 3.13 vision runtime', flush=True)
    visual = stage / 'python-vision'
    copy_python(Path(sys.prefix), visual)
    packages = copy_visual_packages(visual / 'Lib/site-packages')
    # Conda NumPy uses MKL. Preserve its native dispatcher and initialization package.
    for pattern in ('mkl*.dll', 'libiomp*.dll'):
        for source in (Path(sys.prefix) / 'Library/bin').glob(pattern):
            copy_file(source, visual / source.name)
    if (Path(sys.prefix) / 'Lib/site-packages/mkl').exists():
        copy_tree(Path(sys.prefix) / 'Lib/site-packages/mkl', visual / 'Lib/site-packages/mkl')
    print('Preparing portable Python 3.12 provenance and FSD runtimes', flush=True)
    portable_venv(root / '.venv', stage / 'python-provenance')
    portable_venv(root / '.venv-fsd', stage / 'python-fsd')
    print('Collecting fixed model sources and isolated RiSE dependencies', flush=True)
    copy_tools(root, stage / 'tools')
    print('Collecting verified checkpoints and local 2B vision-language model', flush=True)
    checkpoints = copy_models(root, stage / 'models')
    ollama = Path(os.environ['LOCALAPPDATA']) / 'Programs/Ollama'
    (stage / 'ollama').mkdir(exist_ok=True)
    shutil.copy2(ollama / 'ollama.exe', stage / 'ollama/ollama.exe')
    copy_tree(ollama / 'lib', stage / 'ollama/lib')
    notice = stage / 'models/THIRD_PARTY_NOTICES.txt'
    notice.write_text('Internal research distribution only.\nSICA: https://github.com/venus-guangjian/SICA_OpenMMSec\nRITA: https://github.com/scu-zjz/RITA\nRiSE: MIT, https://github.com/KahimWong/RiSE\nFSD: CC BY-NC-SA 4.0, https://github.com/ductai199x/Forensic-Self-Descriptions-CVPR25\nQwen3-VL: Apache-2.0, https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF\nOllama: MIT, https://github.com/ollama/ollama\nPython and installed package licenses are retained in their distribution directories.\n', encoding='utf-8')
    validation = []
    clean_environment = {key: value for key, value in os.environ.items() if key not in ('PYTHONHOME', 'PYTHONPATH')}
    clean_environment['PATH'] = str(Path(os.environ['SystemRoot']) / 'System32') + ';' + os.environ['SystemRoot']
    for name, imports in [('python-vision', 'import torch,torchvision,timm,cv2,numpy,ftfy,einops'),
                          ('python-provenance', 'import c2pa,cv2,pywt;from rapidocr import RapidOCR;RapidOCR()'),
                          ('python-fsd', 'import torch,scipy,sklearn,PIL')]:
        command = f"{imports};import sys,json;print(json.dumps({{'prefix':sys.prefix,'executable':sys.executable}}))"
        result = subprocess.run([str(stage / name / 'python.exe'), '-c', command], cwd=stage,
                                env=clean_environment, capture_output=True, text=True)
        print(result.stdout, flush=True)
        if result.returncode:
            raise RuntimeError(f'{name} portability check failed: {result.stderr[-3000:]}')
        validation.append({'runtime': name, 'result': result.stdout.strip()})
    (root / 'work/research-runtime-portability.json').write_text(json.dumps(validation, indent=2), encoding='utf-8')
    for name in ('python-vision', 'python-provenance', 'python-fsd', 'tools', 'models', 'ollama'):
        components.append(archive_component(stage / name, output, name))
    identifier = hashlib.sha256(''.join(item['sha256'] for item in components).encode()).hexdigest()[:12]
    manifest = {'schemaVersion': 1, 'id': f'research-v1-{identifier}', 'distribution': 'internal-research',
                'components': components, 'checkpoints': checkpoints, 'packages': packages,
                'unpackedBytes': sum(item['unpackedBytes'] for item in components),
                'ollamaModel': 'srdp-qwen3-vl-2b', 'ollamaPort': 11435}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f'Runtime bundle complete: {output}', flush=True)


if __name__ == '__main__':
    main()
