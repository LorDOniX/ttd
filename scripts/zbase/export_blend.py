# Převod jednoho .blend souboru ze zbase na GLB modely pro hru.
# Spouští se uvnitř Blenderu (4.2 LTS), obvykle přes convert.py:
#   blender -b --factory-startup --disable-autoexec soubor.blend --python export_blend.py -- \
#     --out VYSTUP/DIR --stem jmeno [--colors colors.json] [--detail 3000 --max-triangles 8000]
#
# Jeden zbase .blend obsahuje víc modelů vedle sebe (např. 1421-1425.blend = 5 domů) a v každém
# framu animace je pod kamerou jiný z nich. Někde jezdí kamera (vlaky, domy), jinde se posouvají
# modely pod stojící kamerou (stromy). Model = sítě, které jsou v daném framu pod kamerou;
# framy, které jen otáčejí pohledem na tentýž model, se přeskočí.
# Dlaždice má ve zbase 2x2 Blender jednotky, ve hře 1x1.

import argparse
import json
import math
import os
import re
import statistics
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

# Rovinné plochy se slučují do této odchylky normál, vizuálně beze změny
PLANAR_ANGLE = math.radians(1)
# Pod tolik trojúhelníků se jednotlivé díly nezjednodušují (krabička má 12)
MIN_PART_TRIANGLES = 24
# Odchylka zjednodušeného dílu se měří na nejvýš tolika vrcholech
DEVIATION_SAMPLES = 400
# Když zjednodušení překročí toleranci, zkusí se mírnější poměr (× tolik)
RATIO_STEP = 1.6
# Model nad --max-triangles se zkusí znovu s polovičním --detail a dvojnásobnou --tolerance, nejvýš tolikrát
DETAIL_STEPS = 3
# --detail, kterým se začne, když je zadané jen --max-triangles
FALLBACK_DETAIL = 3000
# Materiály pozadí, stínů a masek pro render spritů, ve 3D nemají co dělat
SPECIAL_MATERIAL = re.compile(r'^Special_', re.IGNORECASE)
# Barva společnosti (CC = company colour, 2CC = druhá barva), hra ji přebarví
COMPANY_MATERIAL = re.compile(r'^(2?)CC_', re.IGNORECASE)
# Velikost čtverce jedné barvy v paletě, víc pixelů = méně slévání barev v mipmapách
PALETTE_CELL = 8
# Sítě celé pod touto výškou jsou odložené mimo záběr (pomocné vagony apod.)
MIN_Z = -0.5
RENDERABLE = {'MESH', 'CURVE', 'SURFACE', 'META', 'FONT'}
# Za koncem animace se hledají další modely nejvýš po tolik framů, konec po tolika prázdných
EXTRA_FRAMES = 64
EXTRA_EMPTY_FRAMES = 3


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--stem', required=True)
    parser.add_argument('--colors', help='JSON {materiál: "#rrggbb"} s ručními barvami')
    parser.add_argument(
        '--detail', type=float, default=0, help='max. trojúhelníků dílu na dlaždici² jeho velikosti (0 = beze změny)'
    )
    parser.add_argument(
        '--tolerance', type=float, default=0.004, help='max. odchylka zjednodušeného dílu v dlaždicích'
    )
    parser.add_argument(
        '--max-triangles', type=int, default=0, help='větším modelům se sníží --detail (0 = beze změny)'
    )
    parser.add_argument('--tile-size', type=float, default=2.0, help='velikost dlaždice v Blender jednotkách')
    parser.add_argument('--radius', type=float, help='dosah modelu od středu záběru (jinak z rozestupu modelů)')
    return parser.parse_args(argv)


def linear_to_srgb(c):
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def hex_to_linear(value):
    value = value.lstrip('#')
    srgb = [int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]


def root_of(obj):
    while obj.parent:
        obj = obj.parent
    return obj


def is_special(obj):
    mats = [s.material for s in obj.material_slots]
    return bool(mats) and all(m is not None and SPECIAL_MATERIAL.match(m.name) for m in mats)


def renderable_objects(scene):
    return [
        o
        for o in scene.objects
        if o.type in RENDERABLE and not o.hide_render and o.visible_get() and not is_special(o)
    ]


# Střed půdorysu vůči záběru a horní hrana sítě v aktuálním framu
def placement(obj, center):
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    mid = Vector((sum(c.x for c in corners) / 8, sum(c.y for c in corners) / 8))
    return mid - center, max(c.z for c in corners)


# Vrátí [(frame, střed záběru, sítě)] pro každý samostatný model v pořadí renderu.
# Sprity se renderovaly od framu 0 a animace se za koncem lineárně prodlužuje, některé modely
# (např. poslední díl elektrárny) leží až za frame_end uloženým v souboru.
def collect_models(scene, objs, radius, log):
    camera = scene.camera or next((o for o in scene.objects if o.type == 'CAMERA'), None)
    rig = root_of(camera) if camera else None

    def sample(frame):
        scene.frame_set(frame)
        center = rig.matrix_world.translation.xy.copy() if rig else Vector((0, 0))
        return frame, center, {o: placement(o, center) for o in objs}

    samples = [sample(f) for f in range(min(0, scene.frame_start), scene.frame_end + 1)]

    # Rozestup modelů = o kolik se scéna vůči kameře posune mezi dvěma modely
    if radius is None:
        shifts = []
        for (_, _, a), (_, _, b) in zip(samples, samples[1:]):
            moved = [(b[o][0] - a[o][0]).length for o in objs]
            moved = [d for d in moved if d > 0.05]
            if moved:
                shifts.append(statistics.median(moved))
        radius = min(shifts) / 2 if shifts else math.inf

    models = []
    seen = set()
    used = set()

    def pick(frame, center, places):
        members = [o for o in objs if places[o][0].length <= radius and places[o][1] >= MIN_Z]
        key = frozenset(o.name for o in members)
        if members and key not in seen:
            seen.add(key)
            used.update(key)
            models.append((frame, center, members))
            return True
        return bool(members)

    for frame, center, places in samples:
        pick(frame, center, places)

    if rig:
        frame = scene.frame_end
        before = len(models)
        empty = 0
        while len(used) < len(objs) and empty < EXTRA_EMPTY_FRAMES and frame < scene.frame_end + EXTRA_FRAMES:
            frame += 1
            empty = 0 if pick(*sample(frame)) else empty + 1
        if len(models) > before:
            log.append(f'za koncem animace: {len(models) - before} modelů (framy {scene.frame_end + 1}-{frame})')

    unused = [o.name for o in objs if o.name not in used]
    if unused:
        log.append(f'mimo záběr ({len(unused)}): {", ".join(unused[:10])}{" ..." if len(unused) > 10 else ""}')
    return models


def material_color(mat, overrides):
    if mat is None:
        return [0.6, 0.6, 0.6]
    if mat.name in overrides:
        return hex_to_linear(overrides[mat.name])
    return list(mat.diffuse_color[:3])


# Spojí sítě jednoho modelu (s aplikovanými modifikátory) do bmeshe se středem v počátku
def merge_group(objs, center, tile_size, depsgraph):
    to_game = Matrix.Scale(1 / tile_size, 4) @ Matrix.Translation((-center.x, -center.y, 0))
    materials = []
    bm = bmesh.new()
    for obj in objs:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=False, depsgraph=depsgraph)
        matrix = to_game @ obj.matrix_world
        mesh.transform(matrix)
        if matrix.determinant() < 0:
            mesh.flip_normals()
        slot_mats = [s.material for s in obj.material_slots] or [None]
        remap = []
        for mat in slot_mats:
            if mat not in materials:
                materials.append(mat)
            remap.append(materials.index(mat))
        for poly in mesh.polygons:
            poly.material_index = remap[min(poly.material_index, len(remap) - 1)]
        bm.from_mesh(mesh)
        bpy.data.meshes.remove(mesh)

    special = [
        f
        for f in bm.faces
        if materials[f.material_index] is not None and SPECIAL_MATERIAL.match(materials[f.material_index].name)
    ]
    bmesh.ops.delete(bm, geom=special, context='FACES')
    return bm, materials


# Vrcholy (ve světových souřadnicích), polygony a počet trojúhelníků dílu po modifikátorech
def surface(obj, depsgraph):
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    verts = [obj.matrix_world @ v.co for v in mesh.vertices]
    polys = [tuple(p.vertices) for p in mesh.polygons]
    evaluated.to_mesh_clear()
    return verts, polys, sum(len(p) - 2 for p in polys)


def max_distance(points, tree):
    worst = 0.0
    for point in points[:: max(1, len(points) // DEVIATION_SAMPLES)]:
        nearest = tree.find_nearest(point)
        if nearest[0] is None:
            return math.inf
        worst = max(worst, nearest[3])
    return worst


# Nejsilnější zjednodušení od poměru start, při kterém se povrch dílu neodchýlí víc než tolerance
# (oběma směry: ztracené detaily i vyčnívající střepy). Kolo snese 5 %, tvarovaná maska autobusu ne.
def choose_ratio(obj, verts, polys, start, tolerance):
    original = BVHTree.FromPolygons(verts, polys)
    modifier = obj.modifiers.new('zbase_probe', 'DECIMATE')
    try:
        ratio = start
        while ratio < 1.0:
            modifier.ratio = ratio
            simple_verts, simple_polys, _ = surface(obj, bpy.context.evaluated_depsgraph_get())
            simple = BVHTree.FromPolygons(simple_verts, simple_polys)
            if max(max_distance(verts, simple), max_distance(simple_verts, original)) <= tolerance:
                return ratio
            ratio *= RATIO_STEP
        return 1.0
    finally:
        obj.modifiers.remove(modifier)


# Malé díly bývají přehnaně detailní (kolo ~0,1 dlaždice má stovky trojúhelníků) a na obrazovce
# zaberou pár pixelů. Každý díl dostane rozpočet úměrný druhé mocnině své velikosti a zjednoduší se
# samostatně, nejvýš ale tak, aby odchylka nepřekročila toleranci. Stejné díly (kola, panely oken)
# se změří jednou a dopadnou stejně.
# Vrátí přidané modifikátory (po spojení se musí odebrat, díl může patřit i k dalšímu modelu)
# a počet trojúhelníků před zjednodušením.
def limit_part_detail(objs, tile_size, detail, tolerance):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    ratios = {}
    added = []
    total = 0
    for obj in objs:
        if obj.type != 'MESH':
            continue
        verts, polys, triangles = surface(obj, depsgraph)
        total += triangles
        if not detail:
            continue
        corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
        size = max(max(c[i] for c in corners) - min(c[i] for c in corners) for i in range(3)) / tile_size
        budget = max(MIN_PART_TRIANGLES, detail * size * size)
        if triangles <= budget:
            continue
        scale = tuple(round(v, 3) for v in obj.matrix_world.to_scale())
        key = (obj.data.name, tuple(m.type for m in obj.modifiers), scale)
        if key not in ratios:
            ratios[key] = choose_ratio(obj, verts, polys, budget / triangles, tolerance * tile_size)
            depsgraph = bpy.context.evaluated_depsgraph_get()
        if ratios[key] < 1.0:
            modifier = obj.modifiers.new('zbase_detail', 'DECIMATE')
            modifier.ratio = ratios[key]
            added.append((obj, modifier))
    return added, total


def triangle_count(faces):
    return sum(len(f.verts) - 2 for f in faces)


# Sloučí sousední rovinné plochy (stěny z mnoha trojúhelníků), hranice materiálů zůstanou
def dissolve_planar(bm):
    bmesh.ops.dissolve_limit(
        bm, angle_limit=PLANAR_ANGLE, verts=bm.verts, edges=bm.edges, delimit={'MATERIAL'}
    )


def make_palette_image(name, colors):
    grid = 1
    while grid * grid < len(colors):
        grid *= 2
    size = grid * PALETTE_CELL
    image = bpy.data.images.new(name, size, size, alpha=False)
    pixels = [1.0] * (size * size * 4)
    for i, color in enumerate(colors):
        gx, gy = i % grid, i // grid
        srgb = [linear_to_srgb(c) for c in color]
        for y in range(gy * PALETTE_CELL, (gy + 1) * PALETTE_CELL):
            for x in range(gx * PALETTE_CELL, (gx + 1) * PALETTE_CELL):
                pixels[(y * size + x) * 4 : (y * size + x) * 4 + 3] = srgb
    image.pixels = pixels
    image.file_format = 'PNG'
    image.pack()
    uvs = [((i % grid + 0.5) / grid, (i // grid + 0.5) / grid) for i in range(len(colors))]
    return image, uvs


def principled(name, color=None, image=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.85
    if image is not None:
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = image
        tex.interpolation = 'Closest'
        mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    if color is not None:
        bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    return mat


# Běžné materiály -> jedna paleta (1 draw call), barvy společnosti zvlášť, aby je hra mohla přebarvit
def build_object(name, bm, materials, overrides):
    palette_mats = [m for m in materials if m is None or not COMPANY_MATERIAL.match(m.name)]
    company = {}
    for m in materials:
        match = m is not None and COMPANY_MATERIAL.match(m.name)
        if match:
            company.setdefault('company_colour_2' if match.group(1) else 'company_colour', []).append(m)

    image, uvs = make_palette_image(f'{name}_palette', [material_color(m, overrides) for m in palette_mats])
    out_materials = [principled(f'{name}_palette', image=image)]
    slot_of = {materials.index(m): 0 for m in palette_mats}
    for cc_name, mats in company.items():
        out_materials.append(principled(cc_name, color=material_color(mats[0], overrides)))
        for m in mats:
            slot_of[materials.index(m)] = len(out_materials) - 1

    uv_layer = bm.loops.layers.uv.new('UVMap')
    for face in bm.faces:
        mat = materials[face.material_index]
        uv = uvs[palette_mats.index(mat)] if mat in palette_mats else (0.5, 0.5)
        for loop in face.loops:
            loop[uv_layer].uv = uv
        face.material_index = slot_of[face.material_index]

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for mat in out_materials:
        mesh.materials.append(mat)
    return bpy.data.objects.new(name, mesh)


# 1421-1425.blend s pěti modely -> 1421 ... 1425 (čísla spritů v TTD), jinak jméno_00 ...
def model_names(stem, count):
    match = re.fullmatch(r'(\d+)-(\d+)', stem)
    if match and int(match.group(2)) - int(match.group(1)) + 1 == count:
        return [str(int(match.group(1)) + i) for i in range(count)]
    if count == 1:
        return [stem]
    return [f'{stem}_{i:02d}' for i in range(count)]


def main():
    args = parse_args()
    overrides = {}
    if args.colors and os.path.exists(args.colors):
        with open(args.colors, encoding='utf-8') as f:
            overrides = json.load(f)

    scene = bpy.context.scene
    log = [
        f'chybějící knihovna: {lib.filepath}'
        for lib in bpy.data.libraries
        if not os.path.exists(bpy.path.abspath(lib.filepath))
    ]
    models = collect_models(scene, renderable_objects(scene), args.radius, log)

    built = []
    for name, (frame, center, objs) in zip(model_names(args.stem, len(models)), models):
        scene.frame_set(frame)
        # Příliš velký model se nezjednodušuje globálně (rozpadal by se nahodile), ale s menším
        # rozpočtem dílů – všechny stejné díly (okna) se tak zjednoduší stejně
        detail = args.detail
        tolerance = args.tolerance
        for step in range(DETAIL_STEPS + 1):
            modifiers, source_triangles = limit_part_detail(objs, args.tile_size, detail, tolerance)
            bm, materials = merge_group(objs, center, args.tile_size, bpy.context.evaluated_depsgraph_get())
            for obj, modifier in modifiers:
                obj.modifiers.remove(modifier)
            if args.max_triangles or detail:
                dissolve_planar(bm)
            if not args.max_triangles or triangle_count(bm.faces) <= args.max_triangles or step == DETAIL_STEPS:
                break
            bm.free()
            detail = detail / 2 if detail else FALLBACK_DETAIL
            tolerance *= 2
        if not bm.faces:
            bm.free()
            log.append(f'{name}: po odstranění pomocných ploch nic nezbylo')
            continue
        if args.max_triangles and triangle_count(bm.faces) > args.max_triangles:
            log.append(
                f'{name}: {triangle_count(bm.faces)} trojúhelníků i při --detail {detail:g} --tolerance {tolerance:g}'
            )
        obj = build_object(name, bm, materials, overrides)
        built.append((obj, frame, len(objs), [m.name if m else None for m in materials], source_triangles))

    # Původní scéna se vyprázdní, exportér pak vidí jen hotové modely
    for old in list(scene.objects):
        bpy.data.objects.remove(old, do_unlink=True)

    os.makedirs(args.out, exist_ok=True)
    report = []
    for obj, frame, count, source_materials, source_triangles in built:
        scene.collection.objects.link(obj)
        obj.select_set(True)
        path = os.path.join(args.out, f'{obj.name}.glb')
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_format='GLB',
            use_selection=True,
            export_apply=True,
            export_yup=True,
            export_animations=False,
            export_cameras=False,
            export_lights=False,
        )
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        lo = Vector(obj.bound_box[0])
        hi = Vector(obj.bound_box[6])
        report.append(
            {
                'name': obj.name,
                'file': os.path.basename(path),
                'frame': frame,
                'size': [round(v, 3) for v in (hi - lo)],
                'triangles': sum(len(p.vertices) - 2 for p in evaluated.data.polygons),
                'source_triangles': source_triangles,
                'objects': count,
                'materials': source_materials,
            }
        )
        scene.collection.objects.unlink(obj)

    with open(os.path.join(args.out, f'{args.stem}.json'), 'w', encoding='utf-8') as f:
        json.dump({'source': bpy.data.filepath, 'models': report, 'log': log}, f, ensure_ascii=False, indent=2)
    print(f'ZBASE_EXPORT {args.stem}: {len(report)} modelů, {len(log)} upozornění')


main()
