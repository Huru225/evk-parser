// app.js - Evk Parser frontend

// ─── State ────────────────────────────────────────────────────────────────────

let currentProject = null;
let currentProjectName = '';
let currentAnimation = null;
let currentAnimationLayout = '';
let currentAnimName = '';
let currentAnimObjName = '';
let isPlaying = false;
let currentFrame = 0;
let animInterval = null;
let showAnchors = false;
let showCollision = false;
let animations = {};
let sprites = {};
let layouts = [];
let audioFiles = [];
let playbackSpeed = 1;
let isLooping = true;
let frameImages = {};
let audioElement = null;
let currentAudioIndex = -1;
let parseJobKey = null;
let parsePollTimer = null;

// Viewport (pan & zoom)
let vpX = 0, vpY = 0, vpScale = 1;
let isDragging = false, dragStartX = 0, dragStartY = 0, dragVpX = 0, dragVpY = 0;

const API_BASE = '';

// ─── Initialization ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  loadProjects();
  initAudio();
  initCanvasEvents();
});

// ─── Tab System ───────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const tabId = btn.dataset.tab + '-tab';
      document.getElementById(tabId).classList.add('active');
      if (btn.dataset.tab === 'view') {
        loadProjects();
      }
    });
  });
}

// ─── Parse APK Tab ────────────────────────────────────────────────────────────

function browseFolder(type) {
  const inputId = type === 'source' ? 'source-folder' : 'output-folder';
  const currentPath = document.getElementById(inputId).value;
  const path = prompt(`请输入${type === 'source' ? '源' : '输出'}文件夹路径:`, currentPath);
  if (path) {
    document.getElementById(inputId).value = path;
  }
}

async function startParsing() {
  const source = document.getElementById('source-folder').value.trim();
  const output = document.getElementById('output-folder').value.trim();

  if (!source) {
    showNotification('请输入源文件夹路径', 'warning');
    return;
  }

  const parseBtn = document.getElementById('parse-btn');
  parseBtn.disabled = true;
  parseBtn.textContent = '解析中...';

  const progressContainer = document.getElementById('progress-container');
  progressContainer.classList.remove('hidden');

  const resultSummary = document.getElementById('result-summary');
  resultSummary.classList.add('hidden');

  try {
    updateProgress(0, '正在提交解析任务...');

    const response = await fetch(`${API_BASE}/api/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, output: output || undefined }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || '解析请求失败');
    }

    const data = await response.json();
    parseJobKey = data.jobKey;

    // Start polling for progress
    pollParseProgress();

  } catch (error) {
    console.error('解析失败:', error);
    updateProgress(0, '解析失败: ' + error.message);
    showNotification('解析失败: ' + error.message, 'error');
    parseBtn.disabled = false;
    parseBtn.textContent = '开始解析';
  }
}

function pollParseProgress() {
  if (!parseJobKey) return;

  if (parsePollTimer) clearInterval(parsePollTimer);

  parsePollTimer = setInterval(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/parse/status?jobKey=${encodeURIComponent(parseJobKey)}`);
      if (!response.ok) {
        // Job might be completed and cleaned up
        clearInterval(parsePollTimer);
        updateProgress(100, '解析完成！');
        document.getElementById('parse-btn').disabled = false;
        document.getElementById('parse-btn').textContent = '开始解析';
        loadProjects();
        return;
      }

      const data = await response.json();
      updateProgress(data.percent, data.progress);

      if (data.status === 'complete') {
        clearInterval(parsePollTimer);
        parseJobKey = null;

        const resultSteps = document.getElementById('progress-steps');
        if (data.result) {
          resultSteps.innerHTML = `
            <div>Sprites: ${data.result.spriteCount || 0}</div>
            <div>Layouts: ${data.result.layoutCount || 0}</div>
            <div>Audio: ${data.result.audioCount || 0}</div>
          `;
        }

        const resultSummary = document.getElementById('result-summary');
        resultSummary.classList.remove('hidden');
        resultSummary.innerHTML = `
          <h3>Done</h3>
          <p>Project saved to: ${data.result ? data.name : 'output directory'}</p>
        `;

        showNotification('解析完成！', 'success');
        document.getElementById('parse-btn').disabled = false;
        document.getElementById('parse-btn').textContent = '开始解析';
        loadProjects();

      } else if (data.status === 'error') {
        clearInterval(parsePollTimer);
        parseJobKey = null;
        updateProgress(0, '解析失败: ' + data.error);
        showNotification('解析失败: ' + data.error, 'error');
        document.getElementById('parse-btn').disabled = false;
        document.getElementById('parse-btn').textContent = '开始解析';
      }
    } catch (error) {
      console.error('轮询进度失败:', error);
    }
  }, 1000);
}

function updateProgress(percent, text) {
  document.getElementById('progress-fill').style.width = percent + '%';
  document.getElementById('progress-text').textContent = text;
}

// ─── View Project Tab ─────────────────────────────────────────────────────────

async function loadProjects() {
  try {
    const response = await fetch(`${API_BASE}/api/projects`);
    if (!response.ok) throw new Error('加载项目列表失败');

    const projects = await response.json();
    const select = document.getElementById('project-select');
    select.innerHTML = '<option value="">-- 选择项目 --</option>';

    projects.forEach(project => {
      const option = document.createElement('option');
      option.value = project.name;
      const info = [];
      if (project.spriteCount) info.push(`${project.spriteCount} 精灵`);
      if (project.layoutCount) info.push(`${project.layoutCount} 布局`);
      if (project.audioCount) info.push(`${project.audioCount} 音频`);
      option.textContent = `${project.displayName || project.name} (${info.join(', ')})`;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('加载项目列表失败:', error);
  }
}

function loadSelectedProject() {
  const projectName = document.getElementById('project-select').value;
  if (projectName) {
    loadProject(projectName);
  }
}

function loadProjectByPath() {
  const projectPath = document.getElementById('manual-path').value.trim();
  if (projectPath) {
    loadProject(projectPath);
  }
}

async function loadProject(projectName) {
  try {
    showNotification('正在加载项目...', 'info');

    // Load full project data from the animations endpoint (has everything)
    const animResponse = await fetch(`${API_BASE}/api/project/${encodeURIComponent(projectName)}/animations`);
    if (!animResponse.ok) throw new Error('加载动画数据失败');
    const animData = await animResponse.json();
    animations = animData.animations || {};
    layouts = animData.layouts || [];

    const spriteResponse = await fetch(`${API_BASE}/api/project/${encodeURIComponent(projectName)}/sprites`);
    if (!spriteResponse.ok) throw new Error('加载精灵失败');
    sprites = await spriteResponse.json();

    const audioResponse = await fetch(`${API_BASE}/api/project/${encodeURIComponent(projectName)}/audio`);
    if (audioResponse.ok) {
      audioFiles = await audioResponse.json();
    }

    currentProjectName = projectName;
    document.getElementById('viewer-container').classList.remove('hidden');

    buildObjectTree();
    renderAudioFiles();

    if (layouts.length > 0) {
      const canvas = document.getElementById('animation-canvas');
      const firstLayout = layouts[0];
      canvas.width = firstLayout.width || 800;
      canvas.height = firstLayout.height || 600;
    }

    showNotification('项目加载成功', 'success');

  } catch (error) {
    console.error('加载项目失败:', error);
    showNotification('加载项目失败: ' + error.message, 'error');
  }
}

// ─── Object Tree ──────────────────────────────────────────────────────────────

function buildObjectTree() {
  const treeContainer = document.getElementById('object-tree');
  treeContainer.innerHTML = '';

  if (layouts.length === 0) {
    treeContainer.innerHTML = '<p class="placeholder">无布局数据</p>';
    return;
  }

  layouts.forEach(layout => {
    const layoutItem = document.createElement('div');
    layoutItem.className = 'tree-item layout';
    layoutItem.innerHTML = `<strong>${escHtml(layout.name)}</strong> <span class="tree-badge">${layout.width}x${layout.height}</span>`;
    layoutItem.onclick = () => selectLayout(layout.name);
    treeContainer.appendChild(layoutItem);

    const layoutAnims = animations[layout.name];
    if (layoutAnims && layoutAnims.objects) {
      Object.entries(layoutAnims.objects).forEach(([objName, anims]) => {
        const objItem = document.createElement('div');
        objItem.className = 'tree-item object';
        objItem.textContent = objName;
        treeContainer.appendChild(objItem);

        Object.entries(anims).forEach(([animName, animData]) => {
          const animItem = document.createElement('div');
          animItem.className = 'tree-item animation';
          animItem.innerHTML = `${escHtml(animName)} <span class="tree-badge">${(animData.frames || []).length}帧</span>`;
          animItem.onclick = (e) => {
            e.stopPropagation();
            selectAnimation(layout.name, objName, animName, animData);
            treeContainer.querySelectorAll('.tree-item').forEach(el => el.classList.remove('active'));
            animItem.classList.add('active');
          };
          treeContainer.appendChild(animItem);
        });
      });
    }
  });
}

function selectLayout(layoutName) {
  console.log('Layout selected:', layoutName);
}

function filterTree() {
  const query = document.getElementById('tree-search-input').value.toLowerCase().trim();
  const items = document.querySelectorAll('#object-tree .tree-item');
  if (!query) {
    items.forEach(el => el.style.display = '');
    return;
  }
  items.forEach(el => {
    const text = el.textContent.toLowerCase();
    el.style.display = text.includes(query) ? '' : 'none';
  });
}

// ─── Animation Player ─────────────────────────────────────────────────────────

async function selectAnimation(layoutName, objectName, animName, animData) {
  stopAnimation();
  resetViewport();

  currentAnimation = animData;
  currentAnimationLayout = layoutName;
  currentAnimName = animName;
  currentAnimObjName = objectName;

  document.getElementById('anim-name').textContent = `${layoutName} > ${objectName} > ${animName}`;
  document.getElementById('export-btn').style.display = '';

  const timeline = document.getElementById('timeline');
  const frameCount = (animData.frames || []).length;
  timeline.max = Math.max(0, frameCount - 1);
  timeline.value = 0;

  currentFrame = 0;
  updateFrameCounter();

  document.getElementById('canvas-overlay').style.display = 'none';

  await preloadFrames(animData);

  if (frameCount > 0) {
    renderFrame(animData.frames[0]);
  }

  if (animData.frames && animData.frames.length > 0) {
    const frame = animData.frames[0];
    if (frame.spriteId && sprites[frame.spriteId]) {
      showSpriteInfo(sprites[frame.spriteId]);
    }
  }
}

function preloadFrames(animData) {
  frameImages = {};
  if (!animData || !animData.frames) return Promise.resolve();

  const projectName = currentProjectName;
  const total = animData.frames.length;
  let loaded = 0;

  return new Promise((resolve) => {
    if (total === 0) { resolve(); return; }

    animData.frames.forEach((frame, index) => {
      const spriteFile = frame.file || sprites[frame.spriteId]?.file || `sprites/${frame.spriteId}.png`;

      const img = new Image();
      img.onload = () => {
        frameImages[index] = img;
        loaded++;
        if (loaded >= total) resolve();
      };
      img.onerror = () => {
        loaded++;
        if (loaded >= total) resolve();
      };
      img.src = `${API_BASE}/api/file/${encodeURIComponent(projectName)}/${spriteFile}`;
    });
  });
}

function togglePlay() {
  if (isPlaying) {
    pauseAnimation();
  } else {
    playAnimation();
  }
}

async function playAnimation() {
  if (!currentAnimation || !currentAnimation.frames || currentAnimation.frames.length === 0) {
    return;
  }

  // Ensure images are loaded
  const loadedCount = Object.keys(frameImages).length;
  if (loadedCount < currentAnimation.frames.length) {
    await preloadFrames(currentAnimation);
  }

  isPlaying = true;
  document.getElementById('play-btn').className = 'icon-pause';

  const speed = currentAnimation.speed || 1;
  const fps = Math.max(1, Math.round(12 * speed * playbackSpeed));
  const interval = 1000 / fps;

  animInterval = setInterval(() => {
    if (!isLooping && currentFrame >= currentAnimation.frames.length - 1) {
      stopAnimation();
      return;
    }

    currentFrame = (currentFrame + 1) % currentAnimation.frames.length;
    updateFrameCounter();
    renderFrame(currentAnimation.frames[currentFrame]);

    const frame = currentAnimation.frames[currentFrame];
    if (frame && frame.spriteId && sprites[frame.spriteId]) {
      showSpriteInfo(sprites[frame.spriteId]);
    }

  }, interval);
}

function pauseAnimation() {
  isPlaying = false;
  document.getElementById('play-btn').className = 'icon-play';
  if (animInterval) {
    clearInterval(animInterval);
    animInterval = null;
  }
}

function stopAnimation() {
  pauseAnimation();
  currentFrame = 0;
  updateFrameCounter();
  if (currentAnimation && currentAnimation.frames && currentAnimation.frames.length > 0) {
    renderFrame(currentAnimation.frames[0]);
  }
}

function prevFrame() {
  if (!currentAnimation || !currentAnimation.frames) return;
  pauseAnimation();
  currentFrame = Math.max(0, currentFrame - 1);
  updateFrameCounter();
  renderFrame(currentAnimation.frames[currentFrame]);
  updateSpriteInfoForFrame(currentAnimation.frames[currentFrame]);
}

function nextFrame() {
  if (!currentAnimation || !currentAnimation.frames) return;
  pauseAnimation();
  currentFrame = Math.min(currentAnimation.frames.length - 1, currentFrame + 1);
  updateFrameCounter();
  renderFrame(currentAnimation.frames[currentFrame]);
  updateSpriteInfoForFrame(currentAnimation.frames[currentFrame]);
}

function seekToFrame(value) {
  if (!currentAnimation || !currentAnimation.frames) return;
  currentFrame = parseInt(value);
  updateFrameCounter();
  renderFrame(currentAnimation.frames[currentFrame]);
  updateSpriteInfoForFrame(currentAnimation.frames[currentFrame]);
}

function updateFrameCounter() {
  const total = currentAnimation && currentAnimation.frames ? currentAnimation.frames.length : 0;
  document.getElementById('frame-counter').textContent = `帧: ${currentFrame + 1}/${total}`;
  document.getElementById('timeline').value = currentFrame;
}

function updateSpriteInfoForFrame(frame) {
  if (frame && frame.spriteId) {
    const sprite = sprites[frame.spriteId];
    if (sprite) showSpriteInfo(sprite);
  }
}

async function exportCurrentFrames() {
  if (!currentAnimationLayout || !currentAnimName || !currentProjectName) return;
  const btn = document.getElementById('export-btn');
  btn.textContent = '导出中...';
  btn.disabled = true;
  try {
    const resp = await fetch(`${API_BASE}/api/export-frames`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: currentProjectName,
        layout: currentAnimationLayout,
        object: currentAnimObjName,
        animation: currentAnimName,
      }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      alert('导出失败: ' + (err.error || resp.statusText));
      return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentAnimName}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('导出失败: ' + e.message);
  } finally {
    btn.textContent = '导出帧图';
    btn.disabled = false;
  }
}

// ─── Canvas Viewport (pan & zoom) ──────────────────────────────────────────

function initCanvasEvents() {
  const canvas = document.getElementById('animation-canvas');
  if (!canvas) return;

  // Middle mouse button drag to pan
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragVpX = vpX;
    dragVpY = vpY;
    canvas.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    vpX = dragVpX + (e.clientX - dragStartX);
    vpY = dragVpY + (e.clientY - dragStartY);
    if (currentAnimation && currentAnimation.frames) {
      renderFrame(currentAnimation.frames[currentFrame]);
    }
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    const canvas = document.getElementById('animation-canvas');
    if (canvas) canvas.style.cursor = '';
  });

  // Wheel to zoom
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.max(0.1, Math.min(20, vpScale * zoomFactor));

    // Zoom around mouse position
    const scaleChange = newScale / vpScale;
    vpX = mouseX - (mouseX - vpX) * scaleChange;
    vpY = mouseY - (mouseY - vpY) * scaleChange;
    vpScale = newScale;
    updateZoomDisplay();

    if (currentAnimation && currentAnimation.frames) {
      renderFrame(currentAnimation.frames[currentFrame]);
    }
  }, { passive: false });

  // Double-click to reset
  canvas.addEventListener('dblclick', () => {
    resetViewport();
  });
}

function resetViewport() {
  vpX = 0;
  vpY = 0;
  vpScale = 1;
  updateZoomDisplay();
  if (currentAnimation && currentAnimation.frames) {
    renderFrame(currentAnimation.frames[currentFrame]);
  }
}

function updateZoomDisplay() {
  const el = document.getElementById('zoom-display');
  if (el) el.textContent = Math.round(vpScale * 100) + '%';
}

// ─── Canvas Rendering ─────────────────────────────────────────────────────────

function renderFrame(frameData) {
  const canvas = document.getElementById('animation-canvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('canvas-overlay');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(vpX, vpY);
  ctx.scale(vpScale, vpScale);

  if (!frameData) {
    ctx.restore();
    overlay.textContent = '无帧数据';
    overlay.style.display = 'block';
    return;
  }

  overlay.style.display = 'none';

  const img = frameImages[currentFrame];
  if (!img) {
    ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
    ctx.fillRect(canvas.width / 2 - 50, canvas.height / 2 - 50, 100, 100);
    ctx.fillStyle = '#888';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Sprite: ' + frameData.spriteId, canvas.width / 2, canvas.height / 2 + 60);
    ctx.restore();
    return;
  }

  const anchorX = frameData.anchorX != null ? frameData.anchorX : 0.5;
  const anchorY = frameData.anchorY != null ? frameData.anchorY : 0.5;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  const drawX = centerX - img.width * anchorX;
  const drawY = centerY - img.height * anchorY;

  if (showAnchors) {
    drawAnchorBottom(ctx, centerX, centerY);
  }

  ctx.drawImage(img, drawX, drawY, img.width, img.height);

  if (showAnchors) {
    drawAnchor(ctx, centerX, centerY);
  }

  if (showCollision && frameData.polygon && frameData.polygon.length > 0) {
    drawCollisionPolygon(frameData.polygon, drawX, drawY, img.width, img.height, anchorX, anchorY);
  }

  ctx.restore();
}

function drawCheckerboard(ctx, w, h) {
  const size = 10;
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) {
      ctx.fillStyle = ((x / size + y / size) % 2 === 0) ? '#2a2a2a' : '#222';
      ctx.fillRect(x, y, size, size);
    }
  }
}

function drawAnchorBottom(ctx, x, y) {
  ctx.save();
  // Background circle
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Grid lines through center
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x - 40, y); ctx.lineTo(x + 40, y);
  ctx.moveTo(x, y - 40); ctx.lineTo(x, y + 40);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawAnchor(ctx, x, y) {
  ctx.save();
  // Crosshair
  ctx.strokeStyle = '#ff3333';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 12, y);
  ctx.lineTo(x + 12, y);
  ctx.moveTo(x, y - 12);
  ctx.lineTo(x, y + 12);
  ctx.stroke();
  // Center dot
  ctx.fillStyle = '#ff3333';
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCollisionPolygon(polygon, offsetX, offsetY, width, height, anchorX, anchorY) {
  if (!polygon || polygon.length < 3) return;

  const ctx = document.getElementById('animation-canvas').getContext('2d');
  ctx.save();
  ctx.fillStyle = 'rgba(0, 255, 100, 0.2)';
  ctx.strokeStyle = '#00ff66';
  ctx.lineWidth = 1.5;

  // Polygon points are in -0.5 to 0.5 range relative to sprite size
  ctx.beginPath();
  const first = polygon[0];
  ctx.moveTo(
    offsetX + width * (first[0] + anchorX),
    offsetY + height * (first[1] + anchorY)
  );

  for (let i = 1; i < polygon.length; i++) {
    const pt = polygon[i];
    ctx.lineTo(
      offsetX + width * (pt[0] + anchorX),
      offsetY + height * (pt[1] + anchorY)
    );
  }

  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ─── Controls ─────────────────────────────────────────────────────────────────

function changeSpeed() {
  playbackSpeed = parseFloat(document.getElementById('speed-select').value);
  if (isPlaying) {
    pauseAnimation();
    playAnimation();
  }
}

function toggleAnchor() {
  showAnchors = document.getElementById('anchor-checkbox').checked;
  if (currentAnimation && currentAnimation.frames) {
    renderFrame(currentAnimation.frames[currentFrame]);
  }
}

function toggleCollision() {
  showCollision = document.getElementById('collision-checkbox').checked;
  if (currentAnimation && currentAnimation.frames) {
    renderFrame(currentAnimation.frames[currentFrame]);
  }
}

// ─── Properties Panel ─────────────────────────────────────────────────────────

function showSpriteInfo(sprite) {
  if (!sprite) return;

  document.getElementById('sprite-info').innerHTML = `
    <div class="prop-item">
      <span class="prop-label">ID:</span>
      <span class="prop-value">${sprite.id}</span>
    </div>
    <div class="prop-item">
      <span class="prop-label">名称:</span>
      <span class="prop-value">${escHtml(sprite.name || '未命名')}</span>
    </div>
    <div class="prop-item">
      <span class="prop-label">尺寸:</span>
      <span class="prop-value">${sprite.width || 0} × ${sprite.height || 0}</span>
    </div>
  `;

  document.getElementById('anchor-info').innerHTML = `
    <div class="prop-item">
      <span class="prop-label">X:</span>
      <span class="prop-value">${sprite.anchorX != null ? sprite.anchorX.toFixed(2) : '0.50'}</span>
    </div>
    <div class="prop-item">
      <span class="prop-label">Y:</span>
      <span class="prop-value">${sprite.anchorY != null ? sprite.anchorY.toFixed(2) : '0.50'}</span>
    </div>
  `;

  if (sprite.polygon && sprite.polygon.length > 0) {
    document.getElementById('collision-info').innerHTML = `
      <div class="prop-item">
        <span class="prop-label">顶点数:</span>
        <span class="prop-value">${sprite.polygon.length}</span>
      </div>
    `;
  } else {
    document.getElementById('collision-info').innerHTML = '<p class="placeholder">无碰撞数据</p>';
  }

  if (sprite.atlas) {
    document.getElementById('atlas-info').innerHTML = `
      <div class="prop-item">
        <span class="prop-label">图集:</span>
        <span class="prop-value">${escHtml(sprite.atlas)}</span>
      </div>
      <div class="prop-item">
        <span class="prop-label">位置:</span>
        <span class="prop-value">${sprite.atlasX || 0}, ${sprite.atlasY || 0}</span>
      </div>
    `;
  } else {
    document.getElementById('atlas-info').innerHTML = '<p class="placeholder">无图集信息</p>';
  }
}

// ─── Sidebar Toggle ───────────────────────────────────────────────────────────

function toggleSidebar(side) {
  const sidebar = document.querySelector(`.${side}-sidebar`);
  sidebar.classList.toggle('collapsed');
  const btn = sidebar.querySelector('.sidebar-header button');
  if (sidebar.classList.contains('collapsed')) {
    btn.className = side === 'left' ? 'icon-expand-right' : 'icon-expand-left';
  } else {
    btn.className = side === 'left' ? 'icon-collapse-left' : 'icon-collapse-right';
  }
}

// ─── Audio ────────────────────────────────────────────────────────────────────

function initAudio() {
  audioElement = new Audio();
  audioElement.addEventListener('timeupdate', updateAudioProgress);
  audioElement.addEventListener('ended', () => {
    document.getElementById('audio-play-btn').className = 'icon-play';
  });
}

function renderAudioFiles() {
  const container = document.getElementById('audio-files');
  container.innerHTML = '';

  if (!Array.isArray(audioFiles)) return;

  audioFiles.forEach((audio, index) => {
    const item = document.createElement('div');
    item.className = 'audio-file-item';
    item.innerHTML = `
      <span class="audio-file-name">${escHtml(audio.name || audio.hash || `audio ${index + 1}`)}</span>
    `;
    item.onclick = () => selectAudio(index);
    container.appendChild(item);
  });
}

function selectAudio(index) {
  currentAudioIndex = index;
  const audio = audioFiles[index];

  document.querySelectorAll('.audio-file-item').forEach((item, i) => {
    item.classList.toggle('active', i === index);
  });

  document.getElementById('audio-name').textContent = audio.name || audio.hash;

  audioElement.pause();
  audioElement.currentTime = 0;

  const audioSrc = `${API_BASE}/api/file/${encodeURIComponent(currentProjectName)}/${audio.file}`;
  audioElement.src = audioSrc;
  audioElement.play();
  document.getElementById('audio-play-btn').className = 'icon-pause';
}

function playCurrentAudio() {
  if (!audioElement.src) {
    showNotification('请先选择一个音频文件', 'warning');
    return;
  }

  if (audioElement.paused) {
    audioElement.play();
    document.getElementById('audio-play-btn').className = 'icon-pause';
  } else {
    audioElement.pause();
    document.getElementById('audio-play-btn').className = 'icon-play';
  }
}

function stopAudio() {
  audioElement.pause();
  audioElement.currentTime = 0;
  document.getElementById('audio-play-btn').className = 'icon-play';
  document.getElementById('audio-timeline').value = 0;
  document.getElementById('audio-time').textContent = '00:00 / 00:00';
}

function updateAudioProgress() {
  if (!audioElement.duration) return;
  const progress = (audioElement.currentTime / audioElement.duration) * 100;
  document.getElementById('audio-timeline').value = progress;
  document.getElementById('audio-time').textContent =
    `${formatTime(audioElement.currentTime)} / ${formatTime(audioElement.duration)}`;
}

function toggleAudioPanel() {
  document.getElementById('audio-list').classList.toggle('hidden');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function escHtml(str) {
  if (typeof str !== 'string') str = String(str);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showNotification(message, type) {
  const notification = document.createElement('div');
  notification.className = `notification ${type || 'info'}`;
  notification.textContent = message;

  const colors = {
    error: '#fc8181',
    success: '#48bb78',
    warning: '#f6ad55',
    info: '#4299e1',
  };

  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 0.75rem 1.25rem;
    background: ${colors[type] || colors.info};
    color: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 1000;
    font-size: 0.9rem;
    max-width: 400px;
    animation: slideIn 0.3s ease;
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.3s';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
