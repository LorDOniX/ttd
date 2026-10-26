# Kontaktní arch GLB modelů v izometrickém pohledu jako v TTD, na vizuální kontrolu převodu.
# Pod každým modelem je jeho jméno (název souboru).
#   blender -b --factory-startup --python scripts/zbase/preview.py -- nahled.png a.glb b.glb ...

import math
import os
import sys

import bpy
from mathutils import Vector

SPACING = 1.3
# TTD: pohled z rohu dlaždice, kamera 30° nad vodorovnou rovinou
ELEVATION = math.radians(30)
VIEW = Vector((1, -1, math.sqrt(2) * math.tan(ELEVATION))).normalized()
# Osy obrazovky v rovině země: doprava a dozadu (od kamery)
RIGHT = Vector((1, 1, 0)).normalized()
BACK = Vector((-1, 1, 0)).normalized()
PIXELS_PER_UNIT = 220


def add_label(scene, text, position, material):
    curve = bpy.data.curves.new(text, 'FONT')
    curve.body = text
    curve.size = 0.12
    curve.align_x = 'CENTER'
    curve.materials.append(material)
    label = bpy.data.objects.new(text, curve)
    label.location = position
    label.rotation_euler = (-VIEW).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(label)


def import_model(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    roots = [o for o in set(bpy.data.objects) - before if o.parent is None]
    bpy.context.view_layer.update()
    height = max((max((o.matrix_world @ Vector(c)).z for c in o.bound_box) for o in roots if o.type == 'MESH'), default=0)
    return roots, height


def main():
    argv = sys.argv[sys.argv.index('--') + 1 :]
    out, files = argv[0], argv[1:]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    models = [(path, *import_model(path)) for path in files]
    top = max(h for _, _, h in models)
    # Řady jsou od sebe tak daleko, aby nejvyšší model nezakryl řadu za sebou
    row_spacing = max(SPACING, 2 * (top * math.cos(ELEVATION) + 0.45))
    row_height = row_spacing * math.sin(ELEVATION)
    columns = max(1, round(math.sqrt(len(models) * row_height / SPACING)))
    rows = math.ceil(len(models) / columns)

    ink = bpy.data.materials.new('label')
    ink.diffuse_color = (0.02, 0.02, 0.02, 1)
    for i, (path, roots, _) in enumerate(models):
        offset = RIGHT * ((i % columns) * SPACING) - BACK * ((i // columns) * row_spacing)
        for obj in roots:
            obj.location += offset
        name = os.path.splitext(os.path.basename(path))[0]
        add_label(scene, name, offset - BACK * 0.6, ink)

    width = columns * SPACING
    height = rows * row_height + top * math.cos(ELEVATION) * 0.5
    center = RIGHT * ((columns - 1) * SPACING / 2) - BACK * ((rows - 1) * row_spacing / 2) + Vector((0, 0, top / 2))
    camera = bpy.data.objects.new('camera', bpy.data.cameras.new('camera'))
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = max(width, height) * 1.05
    camera.location = center + VIEW * 30
    camera.rotation_euler = (-VIEW).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(camera)
    scene.camera = camera

    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(45), 0, math.radians(20))
    scene.collection.objects.link(sun)
    scene.world = bpy.data.worlds.new('world')
    scene.world.color = (0.45, 0.45, 0.45)

    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 16
    scale = min(1.0, 2000 / (max(width, height) * 1.05 * PIXELS_PER_UNIT))
    scene.render.resolution_x = int(width * 1.05 * PIXELS_PER_UNIT * scale)
    scene.render.resolution_y = int(height * 1.05 * PIXELS_PER_UNIT * scale)
    scene.view_settings.view_transform = 'Standard'
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)


main()
