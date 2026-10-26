#!/usr/bin/env python3
# Projde checkout zbase, každý .blend převede na GLB modely (export_blend.py v Blenderu)
# a výsledky sepíše do manifest.json. Spouští se z kořene repa:
#   python3 scripts/zbase/convert.py --zbase ../zbase --out build-data/zbase --blender ~/blender-4.2/blender
# Volby: --only 'vehicles/rail/*' (glob na relativní cestu), -j 8, --detail 3000 --max-triangles 8000, --include-all

import argparse
import fnmatch
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPORT_SCRIPT = HERE / 'export_blend.py'
COLORS_FILE = HERE / 'colors.json'

# Knihovny materiálů, šablony a efekty (kouř, jiskry, výbuchy) nejsou modely
SKIP = [
    'materials/*',
    'templates/*',
    'textures/*',
    'gui/*',
    'resources/*',
    '*/effects/*',
    '*smoke*',
    '*sparks*',
    '*bubbles*',
    '*/temp.blend',
    '*materials_nature_uv.blend',
]


def parse_args():
    parser = argparse.ArgumentParser(description='Převod zbase .blend -> GLB')
    parser.add_argument('--zbase', required=True, type=Path, help='checkout https://github.com/gravitystorm/zbase')
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--blender', default='blender')
    parser.add_argument('--only', action='append', help='glob na relativní cestu .blend, lze opakovat')
    parser.add_argument('--include-all', action='store_true', help='nepřeskakovat materiály, efekty apod.')
    parser.add_argument('--detail', type=float, default=0, help='max. trojúhelníků dílu na dlaždici² (0 = beze změny)')
    parser.add_argument('--tolerance', type=float, default=0.004, help='max. odchylka dílu v dlaždicích')
    parser.add_argument('--max-triangles', type=int, default=0, help='větší modely se zjednoduší (0 = beze změny)')
    parser.add_argument('-j', '--jobs', type=int, default=max(1, (os.cpu_count() or 2) // 2))
    parser.add_argument('--timeout', type=int, default=600)
    return parser.parse_args()


def find_blends(root, only, include_all):
    for path in sorted(root.rglob('*.blend')):
        rel = path.relative_to(root).as_posix()
        if only and not any(fnmatch.fnmatch(rel, pattern) for pattern in only):
            continue
        if not include_all and any(fnmatch.fnmatch(rel, pattern) for pattern in SKIP):
            continue
        yield rel


def convert(args, rel):
    source = args.zbase / rel
    out_dir = args.out / Path(rel).parent
    stem = Path(rel).stem
    # --disable-autoexec: .blend může obsahovat Python skripty, ty se nesmí spustit
    cmd = [
        args.blender,
        '-b',
        '--factory-startup',
        '--disable-autoexec',
        str(source),
        '--python',
        str(EXPORT_SCRIPT),
        '--',
        '--out',
        str(out_dir),
        '--stem',
        stem,
        '--detail',
        str(args.detail),
        '--tolerance',
        str(args.tolerance),
        '--max-triangles',
        str(args.max_triangles),
    ]
    if COLORS_FILE.exists():
        cmd += ['--colors', str(COLORS_FILE)]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=args.timeout)
    except subprocess.TimeoutExpired:
        return rel, None, 'timeout'
    report_file = out_dir / f'{stem}.json'
    if result.returncode != 0 or not report_file.exists():
        tail = '\n'.join((result.stdout + result.stderr).strip().splitlines()[-15:])
        return rel, None, f'exit {result.returncode}\n{tail}'
    report = json.loads(report_file.read_text(encoding='utf-8'))
    report_file.unlink()
    return rel, report, None


def main():
    args = parse_args()
    if not (args.zbase / 'materials' / 'materials_general.blend').exists():
        sys.exit(f'{args.zbase} nevypadá jako checkout zbase (chybí materials/materials_general.blend)')
    blends = list(find_blends(args.zbase, args.only, args.include_all))
    print(f'{len(blends)} souborů, {args.jobs} paralelně')

    manifest = {}
    failed = {}
    with ThreadPoolExecutor(args.jobs) as pool:
        for i, (rel, report, error) in enumerate(pool.map(lambda r: convert(args, r), blends), 1):
            if error:
                failed[rel] = error
                print(f'[{i}/{len(blends)}] CHYBA {rel}: {error.splitlines()[0]}')
                continue
            manifest[rel] = report
            models = report['models']
            tris = sum(m['triangles'] for m in models)
            print(f'[{i}/{len(blends)}] {rel}: {len(models)} modelů, {tris} trojúhelníků, {len(report["log"])} upozornění')

    args.out.mkdir(parents=True, exist_ok=True)
    summary = {'sources': manifest, 'failed': failed}
    (args.out / 'manifest.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    total = sum(len(r['models']) for r in manifest.values())
    print(f'hotovo: {total} modelů z {len(manifest)} souborů, {len(failed)} chyb -> {args.out / "manifest.json"}')


if __name__ == '__main__':
    main()
