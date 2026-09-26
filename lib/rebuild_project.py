# -*- coding: utf-8 -*-
"""
Rebuild a parsed project with per-animation-frame sprite files.
Each frame gets its own file named {layout}_{animation}_{frameIndex:03d}.png

Usage: python rebuild_project.py <source_www_dir> <output_project_dir>
"""
import json, os, sys, re, shutil
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8')

def clean_name(name):
    if not isinstance(name, str): name = str(name)
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', name)
    return name.strip().strip('.') or "unnamed"

def is_sprite_frame(obj):
    return (isinstance(obj, list) and len(obj) >= 6 and
            isinstance(obj[0], str) and
            obj[0].startswith("assets/images/") and obj[0].endswith(".png"))

def is_animation(obj):
    return (isinstance(obj, list) and len(obj) == 8 and
            isinstance(obj[0], str) and
            isinstance(obj[1], (int, float)) and
            isinstance(obj[7], list))

def rebuild(source_www, output_dir):
    from PIL import Image

    os.makedirs(output_dir, exist_ok=True)
    SPRITES_DIR = os.path.join(output_dir, "sprites")
    AUDIO_DIR = os.path.join(output_dir, "audio")
    os.makedirs(SPRITES_DIR, exist_ok=True)
    os.makedirs(AUDIO_DIR, exist_ok=True)

    # data.json
    data_path = os.path.join(source_www, "data.json")
    if not os.path.exists(data_path):
        return {"error": f"data.json not found in {source_www}"}
    with open(data_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    layouts_data = data["project"][3]
    project_name = clean_name(data["project"][0])

    # n2h.json
    n2h_path = os.path.join(source_www, "n2h.json")
    audio_map = {}
    if os.path.exists(n2h_path):
        with open(n2h_path, "r", encoding="utf-8") as f:
            n2h = json.load(f)
        for orig, hashed in n2h.items():
            if hashed.endswith(('.mp3', '.mp4', '.wav', '.ogg')):
                audio_map[os.path.splitext(os.path.basename(hashed))[0]] = os.path.basename(orig)

    print("Parsing data and cutting sprites...")
    atlas_cache = {}
    animation_tree = {}
    sprites_by_id = {}
    all_frame_files = []

    total_layouts = len(layouts_data)
    for li, layout in enumerate(layouts_data):
        layout_name = clean_name(str(layout[0]))
        if li % 5 == 0 or li == total_layouts - 1:
            print(f"PROGRESS:{(li+1)*60//total_layouts}::layout {li+1}/{total_layouts}", flush=True)
        if len(layout) < 8 or not isinstance(layout[7], list):
            continue
        for anim in layout[7]:
            if not is_animation(anim):
                continue
            anim_name = clean_name(anim[0])
            frames_data = anim[7]

            frame_list = []
            for fi, frame in enumerate(frames_data):
                if not is_sprite_frame(frame):
                    continue
                sid = int(frame[1])
                atlas_name = os.path.basename(frame[0])
                aw, ah = int(frame[4]), int(frame[5])
                ax = frame[7] if len(frame) > 7 else 0.5
                ay = frame[8] if len(frame) > 8 else 0.5
                polygon = frame[9] if len(frame) > 9 else []

                file_name = f"{layout_name}_{anim_name}_{fi:03d}.png"
                file_path = f"sprites/{file_name}"

                frame_entry = {
                    "spriteId": sid, "frameIndex": fi, "id": sid,
                    "atlas": atlas_name,
                    "atlasX": frame[2], "atlasY": frame[3],
                    "width": aw, "height": ah,
                    "anchorX": ax, "anchorY": ay,
                    "polygon": polygon,
                    "name": f"{layout_name}_{anim_name}_{fi:03d}",
                    "file": file_path,
                }
                frame_list.append(frame_entry)

                if str(sid) not in sprites_by_id:
                    sprites_by_id[str(sid)] = {
                        "id": sid, "atlas": atlas_name,
                        "atlasX": frame[2], "atlasY": frame[3],
                        "width": aw, "height": ah,
                        "anchorX": ax, "anchorY": ay,
                        "polygon": polygon,
                        "name": f"{layout_name}_{anim_name}_{fi:03d}",
                        "file": file_path,
                    }

                out_path = os.path.join(SPRITES_DIR, file_name)
                if not os.path.exists(out_path):
                    atlas_path = os.path.join(source_www, "assets", "images", atlas_name)
                    try:
                        if atlas_name not in atlas_cache:
                            atlas_cache[atlas_name] = Image.open(atlas_path)
                        ai = atlas_cache[atlas_name]
                        x, y = int(frame[2]), int(frame[3])
                        if x + aw <= ai.width and y + ah <= ai.height:
                            ai.crop((x, y, x + aw, y + ah)).save(out_path)
                    except:
                        pass

                all_frame_files.append(file_name)

            if frame_list:
                animation_tree.setdefault(layout_name, {"objects": {}})["objects"].setdefault(layout_name, {})[anim_name] = {"frames": frame_list}

    # Audio
    print("Copying audio...")
    print("PROGRESS:60::copying audio", flush=True)
    audio_list = []
    media_dir = os.path.join(source_www, "assets", "media")
    if os.path.exists(media_dir):
        for fname in os.listdir(media_dir):
            if not fname.endswith(('.mp3', '.mp4', '.wav', '.ogg')): continue
            h = os.path.splitext(fname)[0]
            orig = audio_map.get(h, fname)
            safe = re.sub(r'[<>:"/\\|?*]', '_', orig)
            dst = os.path.join(AUDIO_DIR, safe)
            if not os.path.exists(dst):
                shutil.copy2(os.path.join(media_dir, fname), dst)
            audio_list.append({"name": os.path.splitext(orig)[0], "file": f"audio/{safe}", "hash": h})

    anim_count = sum(len(obj) for la in animation_tree.values() for obj in la["objects"].values())
    layouts_list = [{"name": k, "width": 800, "height": 600} for k in animation_tree]

    project = {
        "name": project_name, "source": source_www,
        "spriteCount": len(all_frame_files), "animationCount": anim_count, "audioCount": len(audio_list),
        "sprites": sprites_by_id, "animations": animation_tree,
        "layouts": layouts_list, "audio": audio_list,
    }

    with open(os.path.join(output_dir, "project.json"), "w", encoding="utf-8") as f:
        json.dump(project, f, ensure_ascii=False, indent=2)

    return {"frames": len(all_frame_files), "animations": anim_count, "audio": len(audio_list), "name": project_name}

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python rebuild_project.py <source_www_dir> <output_project_dir>")
        sys.exit(1)
    result = rebuild(sys.argv[1], sys.argv[2])
    print(json.dumps(result, ensure_ascii=False))
