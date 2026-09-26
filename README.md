# Evk Parser

> **Note: This code was organized with AI assistance; some parts may be incorrect.**

Parse 唤境 (Evk) game engine APK files to extract sprites, animations, and audio with a web-based viewer.

## Features

- **APK Parsing** — Extract sprites from atlas PNGs, restore audio file names, build animation tree
- **Animation Viewer** — Play animations on canvas with frame controls, speed adjustment, loop toggle
- **Anchor & Collision** — Visualize anchor points and collision polygons on each sprite
- **Pan & Zoom** — Middle-mouse drag to pan, scroll wheel to zoom, double-click to reset
- **Frame Export** — Export all frames of an animation aligned by anchor point as a ZIP (same canvas size)
- **Object Search** — Filter the object/animation tree by name
- **evk Export** — Export parsed project as a basic .evk archive (images + audio + object definitions)

## Quick Start

```bash
cd evk-parser
npm install
node server.js
```

Open `http://localhost:3000` in your browser.

Or double-click `start.bat` on Windows — it handles port conflicts and dependency installation automatically.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `PROJECTS_DIR` | `../parsed_projects` | Where parsed projects are stored |
| `SOURCES_DIR` | `..` | Where to scan for APK source folders |

## Usage

### Parse an APK

1. Go to the **Parse APK** tab
2. Enter the path to an extracted APK folder (must contain `assets/www/data.json`)
3. Optionally enter an output path (defaults to `parsed_projects/<folder_name>/`)
4. Click **Parse** and wait for extraction to complete

### View a Project

1. Go to the **View Project** tab
2. Select a parsed project from the dropdown, or enter a path manually
3. Browse the object tree on the left, click an animation to play it
4. Use player controls: play/pause, step frame, speed, loop, anchor overlay, collision overlay
5. Middle-mouse drag to pan, scroll to zoom, double-click to reset view

### Export Frames

When viewing an animation, click **Export Frames** to download a ZIP containing all frames aligned by anchor point (same canvas size per frame).

## Project Structure

```
evk-parser/
├── server.js                  # Express server, API routes
├── lib/
│   ├── parser.js              # Parse orchestrator (calls rebuild_project.py)
│   ├── rebuild_project.py     # Core parser: data.json + atlas cutting
│   ├── atlas.js               # Atlas cutting helper (legacy)
│   ├── export_frames.py       # Anchor-aligned frame export
│   └── exporter.js            # evk archive export
├── public/
│   ├── index.html             # Web UI
│   ├── app.js                 # Frontend logic
│   └── style.css              # Styles
├── start.bat                  # Windows launcher
├── package.json
└── .gitignore
```

## API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/projects` | List parsed projects |
| `GET` | `/api/project/:name` | Project summary |
| `GET` | `/api/project/:name/sprites` | Sprite metadata |
| `GET` | `/api/project/:name/animations` | Animation tree |
| `GET` | `/api/project/:name/audio` | Audio list |
| `POST` | `/api/parse` | Start parsing `{source, output}` |
| `GET` | `/api/parse/status?jobKey=...` | Poll parse progress |
| `GET` | `/api/file/:name/*` | Serve file from project |
| `POST` | `/api/export-frames` | Export animation frames as ZIP |
| `POST` | `/api/export-evk` | Export project as .evk |

## Dependencies

- **Node.js** ≥ 14
- **Python 3** with **Pillow** (`pip install Pillow`)
- **Express** (installed via npm)

## License

MIT
