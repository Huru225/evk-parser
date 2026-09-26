/**
 * lib/parser.js - Main parser for 唤境 (Evk) APK extracted files
 *
 * Delegates heavy lifting to lib/rebuild_project.py:
 *   - cuts every animation frame to its own file {layout}_{anim}_{frame:03d}.png
 *   - writes correct `file` on each frame
 *   - builds the layout > objects > animations > frames tree
 *
 * Python outputs progress lines like:
 *   PROGRESS:42::layout 12/35
 *   PROGRESS:60::copying audio
 *   JSON result on the last line
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanName(name) {
  if (typeof name !== 'string') name = String(name);
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+$/, '').trim() || 'unnamed';
}

function findWwwDir(sourceDir) {
  const candidates = [
    path.join(sourceDir, 'assets', 'www'),
    path.join(sourceDir, 'www'),
    sourceDir,
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  }
  return sourceDir;
}

function findFile(sourceDir, filename) {
  const candidates = [
    path.join(sourceDir, filename),
    path.join(sourceDir, 'assets', 'www', filename),
    path.join(sourceDir, 'www', filename),
    path.join(sourceDir, 'assets', filename),
  ];
  for (const fp of candidates) {
    if (fs.existsSync(fp)) return fp;
  }
  function search(dir, depth) {
    if (depth > 4) return null;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name === filename) return path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const r = search(path.join(dir, entry.name), depth + 1);
          if (r) return r;
        }
      }
    } catch (e) {}
    return null;
  }
  return search(sourceDir, 0);
}

// ─── Main Parse ───────────────────────────────────────────────────────────────

async function parseProject(sourceDir, outputDir, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const startTime = Date.now();

  console.log(`[parser] Starting parse: ${sourceDir} -> ${outputDir}`);
  onProgress('Locating source files...', 0);

  const wwwDir = findWwwDir(sourceDir);
  const dataJsonPath = findFile(sourceDir, 'data.json');
  if (!dataJsonPath) throw new Error(`data.json not found in ${sourceDir}`);

  console.log(`[parser] data.json: ${dataJsonPath}`);
  fs.mkdirSync(outputDir, { recursive: true });

  // ── Spawn Python with real-time progress ──
  const scriptPath = path.join(__dirname, 'rebuild_project.py');
  const args = [scriptPath, wwwDir, outputDir];

  console.log(`[parser] Running: python ${args.map(a => `"${a}"`).join(' ')}`);
  onProgress('Parsing data and cutting sprites...', 5);

  const py = spawn('python', ['-u', ...args], {
    timeout: 600000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  let stderrBuf = '';

  const progressHandler = (line) => {
    const m = line.match(/^PROGRESS:(\d+)::(.+)$/);
    if (m) {
      const pct = parseInt(m[1], 10);
      const msg = m[2];
      console.log(`[parser] Progress: ${pct}% - ${msg}`);
      onProgress(msg, pct);
      return true;
    }
    return false;
  };

  py.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    let nlIdx;
    while ((nlIdx = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, nlIdx).trim();
      stdoutBuf = stdoutBuf.slice(nlIdx + 1);
      if (line) progressHandler(line);
    }
  });

  py.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
  });

  // Wait for process to finish
  await new Promise((resolve, reject) => {
    py.on('close', (code) => {
      // Flush remaining stdout
      if (stdoutBuf.trim()) {
        const lines = stdoutBuf.trim().split('\n');
        for (const line of lines) {
          if (line.trim()) progressHandler(line.trim());
        }
      }
      if (code !== 0) {
        const errMsg = stderrBuf.slice(0, 1000);
        console.error(`[parser] Python exited with code ${code}: ${errMsg}`);
        reject(new Error(`Python script failed (exit ${code}): ${errMsg}`));
      } else {
        resolve();
      }
    });
    py.on('error', (err) => {
      reject(new Error(`Failed to start Python: ${err.message}`));
    });
  });

  // ── Parse the last line as JSON result ──
  const allLines = stdoutBuf.trim().split('\n');
  // Also check the accumulated stdout
  const resultStr = allLines.filter(l => l.trim().startsWith('{') && l.includes('"frames"')).pop();
  let summary;
  if (resultStr) {
    try { summary = JSON.parse(resultStr); } catch (e) {}
  }
  if (!summary) {
    // Try reading from project.json
    const pjPath = path.join(outputDir, 'project.json');
    if (fs.existsSync(pjPath)) {
      const pj = JSON.parse(fs.readFileSync(pjPath, 'utf-8'));
      summary = {
        frames: pj.spriteCount || 0,
        animations: pj.animationCount || 0,
        audio: pj.audioCount || 0,
        name: pj.name || '',
      };
    } else {
      throw new Error('No result from Python script');
    }
  }

  if (summary.error) throw new Error(summary.error);

  const projectJsonPath = path.join(outputDir, 'project.json');
  const projectOutput = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[parser] Done in ${elapsed}s: ${summary.frames} frames, ${summary.animations} animations`);
  onProgress(`Done! ${summary.frames} frames, ${summary.animations} animations (${elapsed}s)`, 100);

  return projectOutput;
}

module.exports = { parseProject, cleanName };
