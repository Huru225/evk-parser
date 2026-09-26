/**
 * server.js - Express server for Evk Parser
 *
 * API Routes:
 *   GET  /                              -> index.html
 *   GET  /api/sources                   -> list available source folders
 *   GET  /api/projects                  -> list parsed projects
 *   POST /api/parse                     -> parse APK folder {source, output}
 *   GET  /api/parse/status?jobKey=...   -> check parse progress
 *   GET  /api/project/:name             -> project info
 *   GET  /api/project/:name/sprites     -> all sprites
 *   GET  /api/project/:name/animations  -> animation data
 *   GET  /api/project/:name/audio       -> audio list
 *   GET  /api/file/:name/*              -> serve file from project folder
 *   POST /api/export-evk                -> export as evk project file
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { parseProject } = require('./lib/parser');
const { exportEvk } = require('./lib/exporter');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Configuration ────────────────────────────────────────────────────────────

const PROJECTS_DIR = process.env.PROJECTS_DIR ||
  path.join(__dirname, '..', 'parsed_projects');

const SOURCES_DIR = process.env.SOURCES_DIR ||
  path.join(__dirname, '..');

fs.mkdirSync(PROJECTS_DIR, { recursive: true });

// Track active parse operations
const activeJobs = new Map();

// ─── API Routes ───────────────────────────────────────────────────────────────

/**
 * GET /api/sources - List available source folders (APK extracted dirs)
 */
app.get('/api/sources', (req, res) => {
  try {
    const sources = [];
    scanForSources(SOURCES_DIR, sources, 3);
    res.json(sources);
  } catch (err) {
    console.error('[api] Error listing sources:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/projects - List all parsed projects
 */
app.get('/api/projects', (req, res) => {
  try {
    const projects = [];
    if (fs.existsSync(PROJECTS_DIR)) {
      const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const projectJson = path.join(PROJECTS_DIR, entry.name, 'project.json');
          if (fs.existsSync(projectJson)) {
            try {
              const meta = JSON.parse(fs.readFileSync(projectJson, 'utf-8'));
              projects.push({
                name: entry.name,
                displayName: meta.name || entry.name,
                path: path.join(PROJECTS_DIR, entry.name),
                spriteCount: Object.keys(meta.sprites || {}).length,
                layoutCount: (meta.layouts || []).length,
                audioCount: (meta.audio || []).length,
              });
            } catch (e) {
              projects.push({ name: entry.name, path: path.join(PROJECTS_DIR, entry.name) });
            }
          }
        }
      }
    }
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/parse - Parse an APK folder
 * Body: { source: string, output?: string }
 */
app.post('/api/parse', async (req, res) => {
  const { source, output } = req.body;

  if (!source) {
    return res.status(400).json({ error: 'source path is required' });
  }

  if (!fs.existsSync(source)) {
    return res.status(400).json({ error: `Source path does not exist: ${source}` });
  }

  const sourceName = path.basename(source);
  const outputDir = output || path.join(PROJECTS_DIR, sourceName);

  const jobKey = `${source}->${outputDir}`;
  if (activeJobs.has(jobKey)) {
    return res.json({ status: 'running', jobKey, message: 'Parse already in progress' });
  }

  const job = {
    source,
    outputDir,
    status: 'running',
    progress: '',
    percent: 0,
    startTime: Date.now(),
    result: null,
    error: null,
  };
  activeJobs.set(jobKey, job);

  parseProject(source, outputDir, {
    onProgress: (msg, pct) => {
      job.progress = msg;
      job.percent = pct;
    },
  })
    .then(result => {
      job.status = 'complete';
      job.progress = 'Done!';
      job.percent = 100;
      job.result = {
        name: result.name,
        spriteCount: Object.keys(result.sprites || {}).length,
        layoutCount: (result.layouts || []).length,
        audioCount: (result.audio || []).length,
      };
      console.log(`[api] Parse complete: ${source} -> ${outputDir}`);
    })
    .catch(err => {
      job.status = 'error';
      job.error = err.message;
      console.error(`[api] Parse error: ${err.message}`);
    })
    .finally(() => {
      setTimeout(() => activeJobs.delete(jobKey), 5 * 60 * 1000);
    });

  res.json({ status: 'started', jobKey, outputDir });
});

/**
 * GET /api/parse/status - Check parse progress
 */
app.get('/api/parse/status', (req, res) => {
  const { jobKey } = req.query;
  if (!jobKey) {
    return res.status(400).json({ error: 'jobKey query parameter required' });
  }

  const job = activeJobs.get(jobKey);
  if (!job) {
    return res.status(404).json({ error: 'Job not found or already completed' });
  }

  res.json({
    status: job.status,
    progress: job.progress,
    percent: job.percent,
    error: job.error,
    result: job.result,
    elapsed: Date.now() - job.startTime,
  });
});

/**
 * GET /api/project/:name - Get project summary
 */
app.get('/api/project/:name', (req, res) => {
  try {
    const projectDir = getProjectDir(req.params.name);
    if (!projectDir) {
      return res.status(404).json({ error: `Project not found: ${req.params.name}` });
    }

    const projectJson = path.join(projectDir, 'project.json');
    const project = JSON.parse(fs.readFileSync(projectJson, 'utf-8'));

    res.json({
      name: project.name,
      source: project.source,
      spriteCount: Object.keys(project.sprites || {}).length,
      layoutCount: (project.layouts || []).length,
      audioCount: (project.audio || {}).length,
      animationCount: Object.values(project.animations || {}).reduce((sum, la) => {
        return sum + Object.values(la.objects || {}).reduce((s, obj) => s + Object.keys(obj).length, 0);
      }, 0),
      layouts: (project.layouts || []).map(l => ({
        name: l.name,
        width: l.width,
        height: l.height,
        objectCount: Object.keys(l.objects || {}).length,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/project/:name/sprites - All sprites with metadata
 */
app.get('/api/project/:name/sprites', (req, res) => {
  try {
    const projectDir = getProjectDir(req.params.name);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const projectJson = path.join(projectDir, 'project.json');
    const project = JSON.parse(fs.readFileSync(projectJson, 'utf-8'));
    res.json(project.sprites || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/project/:name/animations - Animation data
 */
app.get('/api/project/:name/animations', (req, res) => {
  try {
    const projectDir = getProjectDir(req.params.name);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const projectJson = path.join(projectDir, 'project.json');
    const project = JSON.parse(fs.readFileSync(projectJson, 'utf-8'));
    res.json({
      animations: project.animations || {},
      layouts: project.layouts || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/project/:name/audio - Audio list
 */
app.get('/api/project/:name/audio', (req, res) => {
  try {
    const projectDir = getProjectDir(req.params.name);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const projectJson = path.join(projectDir, 'project.json');
    const project = JSON.parse(fs.readFileSync(projectJson, 'utf-8'));
    res.json(project.audio || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/file/:name/* - Serve a file from project folder
 */
app.get('/api/file/:name/*', (req, res) => {
  const projectName = req.params.name;
  const filePath = req.params[0];

  const projectDir = getProjectDir(projectName);
  if (!projectDir) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const fullPath = path.join(projectDir, filePath);
  const resolved = path.resolve(fullPath);

  if (!resolved.startsWith(path.resolve(projectDir))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.sendFile(resolved);
});

/**
 * POST /api/export-frames - Export animation frames aligned by anchor
 * Body: { project, layout, object, animation }
 */
app.post('/api/export-frames', (req, res) => {
  const { project, layout, object: objName, animation } = req.body;
  if (!project || !layout || !objName || !animation) {
    return res.status(400).json({ error: 'project, layout, object, animation required' });
  }

  const projectDir = getProjectDir(project);
  if (!projectDir) return res.status(404).json({ error: 'Project not found' });

  const outDir = path.join(projectDir, '_export_temp', animation);
  const scriptPath = path.join(__dirname, 'lib', 'export_frames.py');

  const cmd = `python "${scriptPath}" "${projectDir}" "${layout}" "${objName}" "${animation}" "${outDir}"`;
  const { execSync } = require('child_process');

  try {
    const output = execSync(cmd, { timeout: 60000, encoding: 'utf-8' });
    const result = JSON.parse(output.trim());
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    // Send the zip file
    const zipPath = path.join(projectDir, '_export_temp', `${animation}.zip`);
    if (fs.existsSync(zipPath)) {
      res.download(zipPath, `${animation}.zip`, (err) => {
        // Clean up temp files
        try { fs.rmSync(path.join(projectDir, '_export_temp'), { recursive: true, force: true }); } catch(e) {}
      });
    } else {
      res.status(500).json({ error: 'ZIP file not created' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/export-evk - Export project as .evk file
 */
app.post('/api/export-evk', (req, res) => {
  try {
    const { project, outputPath } = req.body;

    if (!project) {
      return res.status(400).json({ error: 'project name is required' });
    }

    const projectDir = getProjectDir(project);
    if (!projectDir) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const evkPath = outputPath || path.join(PROJECTS_DIR, `${project}.evk`);
    const result = exportEvk(projectDir, evkPath);

    res.json({
      success: true,
      path: result.path,
      fileCount: result.fileCount,
      size: result.size,
    });
  } catch (err) {
    console.error('[api] Export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getProjectDir(name) {
  if (path.isAbsolute(name) && fs.existsSync(name)) {
    const projectJson = path.join(name, 'project.json');
    if (fs.existsSync(projectJson)) return name;
  }

  const projDir = path.join(PROJECTS_DIR, name);
  if (fs.existsSync(projDir)) return projDir;

  return null;
}

function scanForSources(dir, results, maxDepth, currentDepth) {
  currentDepth = currentDepth || 0;
  if (currentDepth > maxDepth) return;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules' ||
          entry.name === 'parsed_projects') continue;

      const subDir = path.join(dir, entry.name);

      const hasDataJson = fs.existsSync(path.join(subDir, 'data.json')) ||
        fs.existsSync(path.join(subDir, 'assets', 'www', 'data.json'));

      if (hasDataJson) {
        const alreadyParsed = results.some(r => r.path === subDir);
        if (!alreadyParsed) {
          results.push({
            name: entry.name,
            path: subDir,
          });
        }
      }

      scanForSources(subDir, results, maxDepth, currentDepth + 1);
    }
  } catch (e) { /* skip inaccessible dirs */ }
}

// ─── Start Server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║     唤境 (Evk) Parser Server v1.0.0         ║
║                                              ║
║  URL: http://localhost:${PORT}                 ║
║  Projects: ${PROJECTS_DIR}                   ║
╚══════════════════════════════════════════════╝
  `);
});
