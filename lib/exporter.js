/**
 * lib/exporter.js - Export parsed project as .evk file
 *
 * The .evk format is a ZIP archive containing:
 *   objectTypes/*.json  - object type definitions
 *   layouts/*.json      - layout definitions
 *   images/*            - sprite PNG files
 *   music/*             - audio files
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Export a parsed project as an .evk file
 *
 * @param {string} projectDir - Directory containing project.json and extracted assets
 * @param {string} outputPath - Path for the output .evk file
 * @returns {object} export result with file count and path
 */
function exportEvk(projectDir, outputPath) {
  console.log(`[exporter] Exporting ${projectDir} -> ${outputPath}`);

  // Read project.json
  const projectJsonPath = path.join(projectDir, 'project.json');
  if (!fs.existsSync(projectJsonPath)) {
    throw new Error(`project.json not found in ${projectDir}`);
  }

  const project = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));

  // Create a temporary staging directory for the evk structure
  const stagingDir = path.join(projectDir, '_evk_staging');
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(path.join(stagingDir, 'objectTypes'), { recursive: true });
  fs.mkdirSync(path.join(stagingDir, 'layouts'), { recursive: true });
  fs.mkdirSync(path.join(stagingDir, 'images'), { recursive: true });
  fs.mkdirSync(path.join(stagingDir, 'music'), { recursive: true });

  let fileCount = 0;

  try {
    // ── Export objectTypes ──
    // Each sprite becomes an objectType
    const objectTypeIds = new Set();
    for (const [spriteId, sprite] of Object.entries(project.sprites || {})) {
      const objType = {
        id: parseInt(spriteId) || spriteId,
        name: sprite.name || spriteId,
        animations: {},
      };

      // Add animation info
      if (sprite.animations) {
        for (const animRef of sprite.animations) {
          const animKey = `${animRef.layout}_${animRef.animation}`;
          if (!objType.animations[animKey]) {
            objType.animations[animKey] = {
              layout: animRef.layout,
              animation: animRef.animation,
              frames: [],
            };
          }
          objType.animations[animKey].frames.push({
            frameIndex: animRef.frameIndex,
            spriteFile: sprite.file || `${spriteId}.png`,
          });
        }
      }

      const filename = `${spriteId}.json`;
      fs.writeFileSync(
        path.join(stagingDir, 'objectTypes', filename),
        JSON.stringify(objType, null, 2),
        'utf-8'
      );
      objectTypeIds.add(spriteId);
      fileCount++;
    }

    // ── Export layouts ──
    for (const layout of project.layouts || []) {
      const layoutData = {
        name: layout.name,
        width: layout.width,
        height: layout.height,
        objects: layout.objects || {},
      };

      const filename = `${layout.name}.json`;
      const safeFilename = filename.replace(/[<>:"/\\|?*]/g, '_');
      fs.writeFileSync(
        path.join(stagingDir, 'layouts', safeFilename),
        JSON.stringify(layoutData, null, 2),
        'utf-8'
      );
      fileCount++;
    }

    // ── Export images ──
    const spritesDir = path.join(projectDir, 'sprites');
    if (fs.existsSync(spritesDir)) {
      const images = fs.readdirSync(spritesDir).filter(f => /\.(png|jpg|jpeg)$/i.test(f));
      for (const img of images) {
        fs.copyFileSync(
          path.join(spritesDir, img),
          path.join(stagingDir, 'images', img)
        );
        fileCount++;
      }
    }

    // ── Export music ──
    const audioDir = path.join(projectDir, 'audio');
    if (fs.existsSync(audioDir)) {
      const audios = fs.readdirSync(audioDir).filter(f => /\.(mp3|wav|ogg|m4a)$/i.test(f));
      for (const aud of audios) {
        fs.copyFileSync(
          path.join(audioDir, aud),
          path.join(stagingDir, 'music', aud)
        );
        fileCount++;
      }
    }

    // ── Create the ZIP ──
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    // Use Node.js built-in or system zip
    // On Windows, use PowerShell's Compress-Archive
    const evkPath = outputPath.endsWith('.evk') ? outputPath : outputPath + '.evk';

    // Remove existing file
    if (fs.existsSync(evkPath)) {
      fs.unlinkSync(evkPath);
    }

    // Use PowerShell to create ZIP (works on Windows)
    const psScript = `
      Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${evkPath}' -Force
    `;

    try {
      execSync(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, {
        timeout: 30000,
        stdio: 'pipe',
      });
    } catch (e) {
      // Fallback: try using tar or 7z
      try {
        execSync(`tar -cf "${evkPath}" -C "${stagingDir}" .`, {
          timeout: 30000,
          stdio: 'pipe',
        });
      } catch (e2) {
        throw new Error(`Failed to create evk archive: ${e2.message}`);
      }
    }

    console.log(`[exporter] Export complete: ${fileCount} files -> ${evkPath}`);

    return {
      path: evkPath,
      fileCount,
      size: fs.existsSync(evkPath) ? fs.statSync(evkPath).size : 0,
    };
  } finally {
    // Clean up staging directory
    try {
      rmrf(stagingDir);
    } catch (e) {
      console.warn(`[exporter] Failed to clean staging dir: ${e.message}`);
    }
  }
}

/**
 * Recursive directory removal (Node.js 14+ has fs.rmSync, but be safe)
 */
function rmrf(dir) {
  if (fs.rmSync) {
    fs.rmSync(dir, { recursive: true, force: true });
  } else {
    // Manual implementation for older Node.js
    if (fs.existsSync(dir)) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          rmrf(fullPath);
        } else {
          fs.unlinkSync(fullPath);
        }
      }
      fs.rmdirSync(dir);
    }
  }
}

module.exports = {
  exportEvk,
};
