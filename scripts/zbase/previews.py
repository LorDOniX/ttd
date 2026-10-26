#!/usr/bin/env python3
# Náhledy převedených modelů: jeden kontaktní arch na každý zdrojový .blend (preview.py v Blenderu)
# a previews/index.html s porovnáním proti původnímu spritu ze zbase. Spouští se po convert.py:
#   python3 scripts/zbase/previews.py --zbase ../zbase --out build-data/zbase --blender ~/blender-4.2.3-linux-x64/blender

import argparse
import fnmatch
import html
import json
import os
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
PREVIEW_SCRIPT = HERE / 'preview.py'


def parse_args():
    parser = argparse.ArgumentParser(description='Náhledy převedených zbase modelů')
    parser.add_argument('--zbase', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path, help='výstup convert.py (s manifest.json)')
    parser.add_argument('--blender', default='blender')
    parser.add_argument('--only', action='append', help='glob na relativní cestu .blend, lze opakovat')
    parser.add_argument('-j', '--jobs', type=int, default=4)
    parser.add_argument('--timeout', type=int, default=900)
    return parser.parse_args()


# Největší z 256px spritů (první bývá prázdný nebo jen zemní dlaždice)
def original_sprite(zbase, rel):
    folder = zbase / rel.removesuffix('.blend')
    sprites = sorted(folder.glob('256_*.png'))[:16] or sorted(folder.glob('*.png'))[:16]
    return max(sprites, key=lambda p: p.stat().st_size, default=None)


def render(args, rel, report, threads):
    target = args.out / 'previews' / (rel.removesuffix('.blend') + '.png')
    target.parent.mkdir(parents=True, exist_ok=True)
    folder = args.out / Path(rel).parent
    files = [str(folder / m['file']) for m in report['models']]
    cmd = [args.blender, '-b', '--factory-startup', '-t', str(threads), '--python', str(PREVIEW_SCRIPT), '--', str(target), *files]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=args.timeout)
    except subprocess.TimeoutExpired:
        return rel, 'timeout'
    if result.returncode != 0 or not target.exists():
        return rel, f'exit {result.returncode}: ' + ' | '.join((result.stdout + result.stderr).strip().splitlines()[-3:])

    sprite = original_sprite(args.zbase, rel)
    if sprite:
        shutil.copyfile(sprite, target.with_suffix('.orig.png'))
    return rel, None


def write_index(out, sources, failed):
    rows = []
    for rel, report in sources.items():
        base = rel.removesuffix('.blend')
        preview = Path(base + '.png')
        orig = Path(base + '.orig.png')
        if not (out / 'previews' / preview).exists():
            continue
        models = report['models']
        before = sum(m.get('source_triangles', m['triangles']) for m in models)
        after = sum(m['triangles'] for m in models)
        names = ', '.join(m['name'] for m in models)
        log = '<br>'.join(html.escape(line) for line in report['log'])
        orig_img = f'<img src="{orig.as_posix()}" class="orig">' if (out / 'previews' / orig).exists() else ''
        rows.append(
            f'<tr><td><b>{html.escape(rel)}</b><br>{len(models)} modelů, {before} → {after} trojúhelníků'
            f'<div class="names">{html.escape(names)}</div><div class="log">{log}</div></td>'
            f'<td>{orig_img}</td>'
            f'<td><a href="{preview.as_posix()}"><img src="{preview.as_posix()}" class="prev"></a></td></tr>'
        )
    errors = ''.join(f'<li>{html.escape(rel)}: {html.escape(err)}</li>' for rel, err in failed.items())
    page = f'''<!doctype html>
<html lang="cs"><meta charset="utf-8"><title>zbase → GLB</title>
<style>
body {{ font: 14px sans-serif; background: #ddd; margin: 16px; }}
table {{ border-collapse: collapse; }}
td {{ vertical-align: top; padding: 8px; border-bottom: 1px solid #aaa; }}
td:first-child {{ width: 320px; }}
.names, .log {{ color: #555; font-size: 12px; margin-top: 6px; word-break: break-word; }}
.log {{ color: #a33; }}
img.orig {{ max-width: 256px; image-rendering: pixelated; }}
img.prev {{ width: 480px; }}
</style>
<h1>zbase → GLB ({len(rows)} souborů)</h1>
<p>Vlevo původní sprite ze zbase, vpravo převedené modely (klik = plná velikost).</p>
{f"<h2>Chyby</h2><ul>{errors}</ul>" if errors else ""}
<table>{"".join(rows)}</table>
</html>
'''
    (out / 'previews' / 'index.html').write_text(page, encoding='utf-8')


def main():
    args = parse_args()
    manifest = json.loads((args.out / 'manifest.json').read_text(encoding='utf-8'))
    sources = {
        rel: report
        for rel, report in manifest['sources'].items()
        if report['models'] and (not args.only or any(fnmatch.fnmatch(rel, p) for p in args.only))
    }
    threads = max(1, (os.cpu_count() or 2) // args.jobs)
    print(f'{len(sources)} náhledů, {args.jobs} paralelně po {threads} vláknech')

    failed = dict(manifest.get('failed', {}))
    with ThreadPoolExecutor(args.jobs) as pool:
        jobs = pool.map(lambda item: render(args, item[0], item[1], threads), sources.items())
        for i, (rel, error) in enumerate(jobs, 1):
            if error:
                failed[rel] = f'náhled: {error}'
            print(f'[{i}/{len(sources)}] {"CHYBA " if error else ""}{rel}{": " + error if error else ""}')

    write_index(args.out, sources, failed)
    print(f'hotovo -> {args.out / "previews" / "index.html"}')


if __name__ == '__main__':
    main()
