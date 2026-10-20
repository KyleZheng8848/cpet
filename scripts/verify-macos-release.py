#!/usr/bin/env python3
"""Validate the actual macOS bundle and both archives before GitHub publication."""
import argparse
import hashlib
import json
import plistlib
from pathlib import Path
import subprocess
import tempfile


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def verify_app(app, product, version, arch, repo):
    with (app / 'Contents/Info.plist').open('rb') as f:
        info = plistlib.load(f)
    assert info['CFBundleShortVersionString'] == version, info
    assert 'SofunAI' in info.get('NSHumanReadableCopyright', ''), 'Missing publisher'
    binary = app / 'Contents/MacOS' / info['CFBundleExecutable']
    expected = 'x86_64' if arch == 'x64' else 'arm64'
    assert run('lipo', '-archs', str(binary)).split() == [expected], 'Wrong app architecture'
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
    resources = app / 'Contents/Resources'
    if product == 'Musepaper':
        payload = binary.read_bytes()
        assert repo.encode() in payload and b'SofunAI' in payload, 'Missing branding/source URL'
    else:
        # Inspect the archive itself; filesystem-only scans cannot see inside asar.
        js = r"""
const a = require('@electron/asar');
const archive = process.argv[1];
const files = a.listPackage(archive);
const bad = files.filter(p => /(^|\/)(\.env(?:\..*)?|master\.key|store\.json|chat-store\.json|chat-history\.json|settings\.json|schedules\.json|_work|_frames)(\/|$)/.test(p));
if (bad.length) throw new Error('Private/intermediate files in asar: ' + bad.join(', '));
const pkg = JSON.parse(a.extractFile(archive, 'package.json'));
if (pkg.version !== process.argv[2] || !JSON.stringify(pkg).includes(process.argv[3])) throw new Error('Packaged metadata mismatch');
if (!files.includes('/LICENSE')) throw new Error('Missing LICENSE');
let studio = false, source = false;
for (const f of files.filter(p => /\.(js|cjs|html)$/.test(p) && !p.startsWith('/node_modules/'))) {
  const text = a.extractFile(archive, f.slice(1)).toString();
  studio ||= text.includes('SofunAI'); source ||= text.includes(process.argv[3]);
}
if (!studio || !source) throw new Error('Missing application branding/source link');
"""
        subprocess.run(['node', '-e', js, str(resources / 'app.asar'), version, repo], check=True)
    if product == 'CPET':
        for relative in ['bin/libCpetSpeech.dylib', 'bin/cpet-dictation', 'bin/CPET Dictation.app/Contents/MacOS/cpet-dictation']:
            assert expected in run('lipo', '-archs', str(resources / relative)).split(), relative
        native = list((resources / 'app.asar.unpacked/node_modules').rglob('koffi.node'))
        assert native and any(expected in run('lipo', '-archs', str(p)).split() for p in native), 'Missing native koffi for target'
        for skill in ['cpet-cute-skins', 'harsh-optimize-loop', 'cpet-rss-digest']:
            assert (resources / 'skills' / skill / 'SKILL.md').is_file(), skill
        assert {p.name for p in (resources / 'skins').iterdir() if p.is_dir()} == {'赛博幽灵', '数字佳人'}
    forbidden = {'chat-store.json', 'chat-history.json', 'settings.json', 'schedules.json', 'master.key', 'store.json', '.env', '.env.local', '_work', '_frames', 'Local Storage', 'IndexedDB'}
    assert not [str(p) for p in resources.rglob('*') if p.name in forbidden], 'Private/intermediate resource files'


def main():
    parser = argparse.ArgumentParser()
    for arg in ['product', 'version', 'arch', 'repo', 'app', 'stem']:
        parser.add_argument('--' + arg, required=True)
    args = parser.parse_args()
    verify = lambda p: verify_app(p, args.product, args.version, args.arch, args.repo)
    verify(Path(args.app).resolve())
    stem = Path(args.stem).resolve()
    dmg, zipfile = Path(str(stem) + '.dmg'), Path(str(stem) + '.zip')
    assert dmg.stat().st_size > 100_000 and zipfile.stat().st_size > 100_000
    with tempfile.TemporaryDirectory(prefix='release-verify-') as temp:
        stage = Path(temp)
        subprocess.run(['ditto', '-x', '-k', str(zipfile), str(stage)], check=True)
        verify(stage / (args.product + '.app'))
    mounted = plistlib.loads(subprocess.check_output(['hdiutil', 'attach', str(dmg), '-nobrowse', '-readonly', '-plist']))
    mount = next(e['mount-point'] for e in mounted['system-entities'] if 'mount-point' in e)
    try:
        verify(Path(mount) / (args.product + '.app'))
        if args.product in ['Musepaper', 'CPET']:
            assert (Path(mount) / '安装并打开.command').is_file()
    finally:
        subprocess.run(['hdiutil', 'detach', mount], check=True)
    sums = Path('release') / (args.arch + '.sha256')
    def checksum(path):
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        return digest.hexdigest()
    sums.write_text(''.join(checksum(p) + '  ' + p.name + '\n' for p in [dmg, zipfile]))
    print(f'Verified {args.product} {args.version} {args.arch}: bundle, ZIP, DMG, publisher, source link and SHA256')


if __name__ == '__main__':
    main()
