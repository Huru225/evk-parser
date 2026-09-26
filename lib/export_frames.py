# -*- coding: utf-8 -*-
"""
Export animation frames aligned by anchor point.
All frames are placed on a canvas with anchor at center, then cropped to bounding box.
Each frame gets a PNG of identical size.

Usage: python export_frames.py <project_dir> <layout> <object> <animation> <output_dir>
"""
import json, os, sys, zipfile
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')

def export_frames(project_dir, layout_name, obj_name, anim_name, output_dir):
    project_json = os.path.join(project_dir, "project.json")
    with open(project_json, "r", encoding="utf-8") as f:
        project = json.load(f)

    anim_data = (project.get("animations", {})
                 .get(layout_name, {})
                 .get("objects", {})
                 .get(obj_name, {})
                 .get(anim_name, {}))
    frames = anim_data.get("frames", [])
    if not frames:
        return {"error": "No frames found"}

    os.makedirs(output_dir, exist_ok=True)

    # Load all frame images and calculate bounding box
    images = []
    for fi, frame in enumerate(frames):
        file_path = os.path.join(project_dir, frame.get("file", ""))
        if not os.path.exists(file_path):
            images.append(None)
            continue
        img = Image.open(file_path).convert("RGBA")
        images.append(img)

    # Calculate bounding box when all frames aligned by anchor
    # Anchor is at (anchorX * w, anchorY * h) from top-left
    # When anchor is at origin, top-left of each frame is at (-anchorX*w, -anchorY*h)
    min_x, min_y = float('inf'), float('inf')
    max_x, max_y = float('-inf'), float('-inf')

    for img, frame in zip(images, frames):
        if img is None:
            continue
        w, h = img.size
        ax = frame.get("anchorX", 0.5) * w
        ay = frame.get("anchorY", 0.5) * h
        min_x = min(min_x, -ax)
        min_y = min(min_y, -ay)
        max_x = max(max_x, w - ax)
        max_y = max(max_y, h - ay)

    if min_x == float('inf'):
        return {"error": "No valid frames"}

    # Add 1px padding
    min_x = int(min_x) - 1
    min_y = int(min_y) - 1
    max_x = int(max_x) + 1
    max_y = int(max_y) + 1
    canvas_w = max_x - min_x
    canvas_h = max_y - min_y

    # Export each frame
    exported = []
    for fi, (img, frame) in enumerate(zip(images, frames)):
        if img is None:
            continue
        w, h = img.size
        ax = frame.get("anchorX", 0.5) * w
        ay = frame.get("anchorY", 0.5) * h

        canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        # Paste frame at correct position (anchor at -min_x, -min_y)
        paste_x = int(-ax - min_x)
        paste_y = int(-ay - min_y)
        canvas.paste(img, (paste_x, paste_y), img)

        out_name = f"{fi:04d}.png"
        out_path = os.path.join(output_dir, out_name)
        canvas.save(out_path)
        exported.append(out_name)

    # Create ZIP
    zip_path = os.path.join(output_dir, "..", f"{anim_name}.zip")
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for name in exported:
            zf.write(os.path.join(output_dir, name), name)

    return {
        "frameCount": len(exported),
        "width": canvas_w,
        "height": canvas_h,
        "zipPath": os.path.abspath(zip_path),
    }

if __name__ == "__main__":
    if len(sys.argv) < 6:
        print("Usage: python export_frames.py <project_dir> <layout> <object> <animation> <output_dir>")
        sys.exit(1)
    result = export_frames(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    print(json.dumps(result, ensure_ascii=False))
