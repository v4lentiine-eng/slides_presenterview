const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// ดึง pdfjsLib ที่โหลดผ่าน Script Tag บน window
const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];

if (pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;

// Multi-Selection & Transitions State
let selectedPages = new Set([1]);
let lastSelectedPage = 1;
let slideTransitionsMap = {}; 
let globalTransition = 'none';

// Timer State
let remainingSec = 15 * 60;
let overtimeSec = 0;
let isOvertime = false;
let timerRunning = false;
let timerInterval = null;
let timerFormat = 'hh:mm:ss';
let animLoopId = null;

// UI Panels State
let currentLang = 'en';
let isPresentationMode = false;
let isPresentationActive = false;
let isCurrentPanelVisible = true;
let isNextPanelVisible = true;
let isTimerVisible = true;
let isTimerSidebarVisible = true;
let isNotesVisible = true;
let isFilmstripVisible = true;
let notesFontSize = 32;
let lastLeftPanelWidth = '60%';
let lastFilmstripHeight = '155px';

// Tool Engine States
let activeTool = 'none'; 
let isDrawing = false;
let isSpotlightLaserActive = false;
let currentStroke = null;
let annotationsMap = {};
let laserPos = { visible: false, x: 0.5, y: 0.5 };

let activeRenderTasks = {
  mainCanvas: null,
  nextCanvas: null
};

let windowResizeTimer = null;

const translations = {
  en: {
    noFile: "No File Opened", openFile: "📂 Open PDF", btnCurrent: "🖼️ Current", btnNext: "⏭️ Next Slide",
    btnTimer: "⏱️ Timer", btnNotes: "📝 Speaker Notes", btnPresent: "📺 Present (Ctrl+L)",
    currentSlide: "🔴 CURRENT SLIDE", nextSlide: "⏭ NEXT SLIDE", speakerNotes: "📝 SPEAKER NOTES",
    timerTitle: "⏱️ COUNTDOWN TIMER", hr: "Hr:", min: "Min:", sec: "Sec:", msg: "Msg:", timerColor: "Color:",
    notesPlaceholder: "Type notes for this slide..."
  },
  th: {
    noFile: "ยังไม่ได้เปิดไฟล์", openFile: "📂 เปิดไฟล์ PDF", btnCurrent: "🖼️ Current", btnNext: "⏭️ Next Slide",
    btnTimer: "⏱️ ตัวนับเวลา", btnNotes: "📝 โน้ตผู้พูด", btnPresent: "📺 นำเสนอ (Ctrl+L)",
    currentSlide: "🔴 CURRENT SLIDE", nextSlide: "⏭ NEXT SLIDE", speakerNotes: "📝 SPEAKER NOTES",
    timerTitle: "⏱️ COUNTDOWN TIMER", hr: "ชม.:", min: "นาที:", sec: "วิ.:", msg: "ข้อความ:", timerColor: "สี:",
    notesPlaceholder: "บันทึกข้อความสำหรับสไลด์นี้..."
  },
  zh: {
    noFile: "未打开文件", openFile: "📂 打开 PDF", btnCurrent: "🖼️ 当前", btnNext: "⏭️ 下一张",
    btnTimer: "⏱️ 计时器", btnNotes: "📝 演讲者备注", btnPresent: "📺 演示 (Ctrl+L)",
    currentSlide: "🔴 当前幻灯片", nextSlide: "⏭ 下一张幻灯片", speakerNotes: "📝 演讲者备注",
    timerTitle: "⏱️ 倒计时器", hr: "小时:", min: "分钟:", sec: "秒:", msg: "提示:", timerColor: "颜色:",
    notesPlaceholder: "输入本页幻灯片的备注..."
  }
};

function changeLanguage(lang) {
  currentLang = lang;
  const t = translations[lang] || translations.en;

  if (!pdfDoc) document.getElementById('lblFileTag').innerText = t.noFile;
  document.getElementById('btnOpenFile').innerText = t.openFile;
  if (document.getElementById('btnToggleCurrent')) document.getElementById('btnToggleCurrent').innerText = t.btnCurrent;
  if (document.getElementById('btnToggleNext')) document.getElementById('btnToggleNext').innerText = t.btnNext;
  document.getElementById('btnToggleTimer').innerText = t.btnTimer;
  document.getElementById('btnToggleNotes').innerText = t.btnNotes;
  document.getElementById('btnFullscreen').innerText = t.btnPresent;
  document.getElementById('lblCurrentSlide').innerText = t.currentSlide;
  document.getElementById('lblNextSlide').innerText = t.nextSlide;
  document.getElementById('lblSpeakerNotes').innerText = t.speakerNotes;
  document.getElementById('lblTimerTitle').innerText = t.timerTitle;
  document.getElementById('lblHr').innerText = t.hr;
  document.getElementById('lblMin').innerText = t.min;
  document.getElementById('lblSec').innerText = t.sec;
  document.getElementById('lblMsg').innerText = t.msg;
  document.getElementById('lblTimerColor').innerText = t.timerColor;
  document.getElementById('txtNotes').placeholder = t.notesPlaceholder;
}

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('mode') === 'presentation') {
  isPresentationMode = true;
  document.body.classList.add('presentation-mode');
}

async function loadPDF(filePath, startPage = 1) {
  try {
    const data = new Uint8Array(fs.readFileSync(filePath));
    pdfDoc = await pdfjsLib.getDocument({ data }).promise;
    totalPages = pdfDoc.numPages;
    
    const targetPage = parseInt(startPage, 10) || 1;
    currentPage = Math.max(1, Math.min(targetPage, totalPages));

    selectedPages.clear();
    selectedPages.add(currentPage);
    lastSelectedPage = currentPage;

    if (!isPresentationMode) {
      ipcRenderer.send('set-current-pdf', filePath);
      const lblTag = document.getElementById('lblFileTag');
      if (lblTag) lblTag.innerText = `📄 ${path.basename(filePath)}`;
    }
    
    updatePageInfo();
    renderAllViews();
    if (!isPresentationMode) renderThumbnails();
  } catch (err) {
    console.error('Error loading PDF:', err);
  }
}

async function renderPageToCanvas(pageNo, canvasId) {
  if (!pdfDoc) return;

  const mainCanvas = document.getElementById(canvasId);
  if (!mainCanvas) return;

  const container = mainCanvas.parentElement;
  if (!container) return;

  const cw = container.clientWidth;
  const ch = container.clientHeight;
  if (cw === 0 || ch === 0) return;

  if (activeRenderTasks[canvasId]) {
    try {
      await activeRenderTasks[canvasId].cancel();
    } catch (e) {}
    activeRenderTasks[canvasId] = null;
  }

  try {
    const page = await pdfDoc.getPage(pageNo);
    if (!mainCanvas.parentElement) return;

    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const scale = Math.min(cw / unscaledViewport.width, ch / unscaledViewport.height);
    const viewport = page.getViewport({ scale: Math.max(scale, 0.1) * 1.25 });

    const offscreenCanvas = document.createElement('canvas');
    const offscreenCtx = offscreenCanvas.getContext('2d');
    offscreenCanvas.width = Math.round(viewport.width);
    offscreenCanvas.height = Math.round(viewport.height);

    const renderTask = page.render({ canvasContext: offscreenCtx, viewport: viewport });
    activeRenderTasks[canvasId] = renderTask;

    await renderTask.promise;
    activeRenderTasks[canvasId] = null;

    const targetWidth = Math.round(viewport.width);
    const targetHeight = Math.round(viewport.height);

    if (mainCanvas.width !== targetWidth || mainCanvas.height !== targetHeight) {
      mainCanvas.width = targetWidth;
      mainCanvas.height = targetHeight;
    }

    const ctx = mainCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(offscreenCanvas, 0, 0);

    if (canvasId === 'mainCanvas') {
      syncOverlayCanvasDimensions(mainCanvas);
    }
  } catch (e) {
    if (e.name !== 'RenderingCancelledException') {
      console.error('Render page error:', e);
    }
  }
}

function playSlideTransitionEffect(transType, renderNewPageTask) {
  const mainCanvas = document.getElementById('mainCanvas');
  const transCanvas = document.getElementById('transitionCanvas');

  if (!mainCanvas || !transType || transType === 'none' || !transCanvas) {
    if (renderNewPageTask) renderNewPageTask();
    return;
  }

  transCanvas.width = mainCanvas.width;
  transCanvas.height = mainCanvas.height;

  const tCtx = transCanvas.getContext('2d');
  tCtx.clearRect(0, 0, transCanvas.width, transCanvas.height);
  tCtx.drawImage(mainCanvas, 0, 0);

  transCanvas.style.transition = 'none';
  transCanvas.style.opacity = '1';
  transCanvas.style.transform = 'none';

  void transCanvas.offsetWidth;

  if (renderNewPageTask) renderNewPageTask();

  transCanvas.style.transition = 'opacity 0.3s ease-out, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';

  requestAnimationFrame(() => {
    if (transType === 'fade') {
      transCanvas.style.opacity = '0';
    } else if (transType === 'slide-left') {
      transCanvas.style.transform = 'translateX(-100%)';
      transCanvas.style.opacity = '0';
    } else if (transType === 'slide-right') {
      transCanvas.style.transform = 'translateX(100%)';
      transCanvas.style.opacity = '0';
    } else if (transType === 'zoom') {
      transCanvas.style.transform = 'scale(1.1)';
      transCanvas.style.opacity = '0';
    }
  });

  setTimeout(() => {
    transCanvas.style.opacity = '0';
    transCanvas.style.transform = 'none';
    const tCtxClean = transCanvas.getContext('2d');
    tCtxClean.clearRect(0, 0, transCanvas.width, transCanvas.height);
  }, 320);
}

function renderAllViews() {
  if (!pdfDoc) return;
  if (isCurrentPanelVisible || isPresentationMode) {
    renderPageToCanvas(currentPage, 'mainCanvas');
  }
  if (!isPresentationMode && isNextPanelVisible) {
    if (currentPage < totalPages) {
      renderPageToCanvas(currentPage + 1, 'nextCanvas');
    } else {
      const canvas = document.getElementById('nextCanvas');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  }
}

async function renderThumbnails() {
  const filmstrip = document.getElementById('filmstrip');
  if (!filmstrip || isPresentationMode || !pdfDoc) return;
  filmstrip.innerHTML = '';

  for (let i = 1; i <= totalPages; i++) {
    const pageNum = i;
    const card = document.createElement('div');
    card.className = `thumb-card ${pageNum === currentPage ? 'active' : ''}`;
    card.id = `thumb-${pageNum}`;

    card.addEventListener('click', (e) => handleThumbnailClick(e, pageNum));

    const canvas = document.createElement('canvas');
    card.appendChild(canvas);

    const badge = document.createElement('div');
    badge.className = 'thumb-badge';
    badge.id = `badge-${pageNum}`;
    card.appendChild(badge);

    const label = document.createElement('span');
    label.innerText = `Slide ${pageNum}`;
    card.appendChild(label);

    filmstrip.appendChild(card);

    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 0.3 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
      await renderTask.promise;
    } catch (err) {
      if (err.name !== 'RenderingCancelledException') {
        console.warn(`Thumbnail render skipped for page ${pageNum}:`, err);
      }
    }
  }
  updateThumbnailSelectionUI();
}

function handleThumbnailClick(e, pageNum) {
  e.stopPropagation();

  if (e.shiftKey) {
    const start = Math.min(lastSelectedPage, pageNum);
    const end = Math.max(lastSelectedPage, pageNum);
    for (let i = start; i <= end; i++) {
      selectedPages.add(i);
    }
    updateThumbnailSelectionUI();
  } else if (e.ctrlKey || e.metaKey) {
    if (selectedPages.has(pageNum)) {
      if (selectedPages.size > 1) selectedPages.delete(pageNum);
    } else {
      selectedPages.add(pageNum);
    }
    lastSelectedPage = pageNum;
    updateThumbnailSelectionUI();
  } else {
    selectedPages.clear();
    selectedPages.add(pageNum);
    lastSelectedPage = pageNum;
    goToPage(pageNum, true);
  }
}

function selectAllSlides() {
  if (!pdfDoc || totalPages === 0) return;
  selectedPages.clear();
  for (let i = 1; i <= totalPages; i++) {
    selectedPages.add(i);
  }
  updateThumbnailSelectionUI();
}

function updateThumbnailSelectionUI() {
  document.querySelectorAll('.thumb-card').forEach((card, idx) => {
    const pageNum = idx + 1;
    const isCurrent = (pageNum === currentPage);
    const isSelected = selectedPages.has(pageNum);

    card.classList.toggle('active', isCurrent);
    card.classList.toggle('selected', isSelected && !isCurrent);

    const badge = document.getElementById(`badge-${pageNum}`);
    const trans = slideTransitionsMap[pageNum] || globalTransition;
    if (badge) {
      if (trans && trans !== 'none') {
        badge.innerText = trans.toUpperCase();
        badge.style.display = 'block';
      } else {
        badge.style.display = 'none';
      }
    }
  });

  const selectTrans = document.getElementById('selectTransition');
  if (selectTrans) {
    const currentTrans = slideTransitionsMap[currentPage] || globalTransition || 'none';
    selectTrans.value = currentTrans;
  }
}

function applyTransitionToSelected(transitionValue) {
  globalTransition = transitionValue;
  if (selectedPages.size > 0) {
    selectedPages.forEach(p => {
      slideTransitionsMap[p] = transitionValue;
    });
  } else {
    slideTransitionsMap[currentPage] = transitionValue;
  }
  updateThumbnailSelectionUI();
  
  ipcRenderer.send('sync-transitions-map', slideTransitionsMap);

  const selectTrans = document.getElementById('selectTransition');
  if (selectTrans) selectTrans.blur();
}

function goToPage(pageNo, broadcast = true, transTypeOverride = null) {
  const targetPage = parseInt(pageNo, 10);
  if (!pdfDoc || isNaN(targetPage) || targetPage < 1 || targetPage > totalPages) return;
  
  const isChanged = (currentPage !== targetPage);
  currentPage = targetPage;
  
  if (!selectedPages.has(currentPage)) {
    selectedPages.clear();
    selectedPages.add(currentPage);
  }

  const transType = transTypeOverride || slideTransitionsMap[currentPage] || globalTransition || 'none';

  updatePageInfo();
  updateThumbnailSelectionUI();

  if (broadcast) {
    ipcRenderer.send('sync-page', { pageNo: currentPage, transition: transType });
  }

  if (isChanged && transType !== 'none') {
    playSlideTransitionEffect(transType, () => {
      renderAllViews();
      redrawOverlay();
    });
  } else {
    renderAllViews();
    redrawOverlay();
  }
}

function prevPage() { goToPage(currentPage - 1, true); }
function nextPage() { goToPage(currentPage + 1, true); }

function updatePageInfo() {
  const lbl = document.getElementById('lblPageInfo');
  if (lbl) lbl.innerText = `${currentPage} / ${totalPages}`;
}

// ------------------------------------------------------------------------------
// Tool Engine (Pen & Logitech Spotlight Laser)
// ------------------------------------------------------------------------------
function setTool(toolName) {
  if (activeTool === toolName) {
    activeTool = 'none';
  } else {
    activeTool = toolName;
  }

  const btnPen = document.getElementById('btnToolPen');
  const btnLaser = document.getElementById('btnToolLaser');
  const overlayCanvas = document.getElementById('overlayCanvas');

  if (btnPen) btnPen.classList.toggle('active', activeTool === 'pen');
  if (btnLaser) btnLaser.classList.toggle('active', activeTool === 'laser');

  if (overlayCanvas) {
    if (activeTool === 'pen') {
      overlayCanvas.style.cursor = 'crosshair';
    } else {
      overlayCanvas.style.cursor = 'default';
    }
  }
}

function syncOverlayCanvasDimensions(mainCanvas) {
  const overlayCanvas = document.getElementById('overlayCanvas');
  if (!overlayCanvas || !mainCanvas) return;

  if (overlayCanvas.width !== mainCanvas.width || overlayCanvas.height !== mainCanvas.height) {
    overlayCanvas.width = mainCanvas.width;
    overlayCanvas.height = mainCanvas.height;
  }
  
  redrawOverlay();
}

function redrawOverlay() {
  const overlay = document.getElementById('overlayCanvas');
  if (!overlay) return;
  const ctx = overlay.getContext('2d');
  const w = overlay.width;
  const h = overlay.height;

  ctx.clearRect(0, 0, w, h);

  const strokes = annotationsMap[currentPage] || [];
  strokes.forEach(stroke => drawStrokeOnCtx(ctx, stroke, w, h));

  if (currentStroke) {
    drawStrokeOnCtx(ctx, currentStroke, w, h);
  }

  if (laserPos.visible) {
    drawLaserDotOnCtx(ctx, laserPos.x * w, laserPos.y * h);
  }
}

function drawStrokeOnCtx(ctx, stroke, w, h) {
  if (!stroke.points || stroke.points.length === 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (stroke.isHighlighter) {
    ctx.globalAlpha = 0.45;
  }

  const p0 = stroke.points[0];
  ctx.moveTo(p0.x * w, p0.y * h);

  for (let i = 1; i < stroke.points.length; i++) {
    const p = stroke.points[i];
    ctx.lineTo(p.x * w, p.y * h);
  }
  ctx.stroke();
  ctx.restore();
}

function drawLaserDotOnCtx(ctx, x, y) {
  ctx.save();
  const grad = ctx.createRadialGradient(x, y, 2, x, y, 18);
  grad.addColorStop(0, 'rgba(255, 23, 68, 1)');
  grad.addColorStop(0.4, 'rgba(255, 82, 82, 0.8)');
  grad.addColorStop(1, 'rgba(255, 23, 68, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, 18, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function undoAnnotation() {
  if (!annotationsMap[currentPage] || annotationsMap[currentPage].length === 0) return;
  annotationsMap[currentPage].pop();
  redrawOverlay();
  ipcRenderer.send('sync-annotations', { pageNo: currentPage, strokes: annotationsMap[currentPage] });
}

function clearAnnotations() {
  annotationsMap[currentPage] = [];
  redrawOverlay();
  ipcRenderer.send('sync-annotations', { pageNo: currentPage, strokes: [] });
}

function initOverlayCanvasEvents() {
  const overlayCanvas = document.getElementById('overlayCanvas');
  const mainCanvasBox = document.getElementById('mainCanvasBox');
  if (!overlayCanvas || !mainCanvasBox || isPresentationMode) return;

  overlayCanvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    clearAnnotations();
  });

  overlayCanvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) return;

    const rect = overlayCanvas.getBoundingClientRect();

    if (activeTool === 'pen') {
      isDrawing = true;
      const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const color = document.getElementById('penColorPicker').value || '#FF1744';
      const size = parseInt(document.getElementById('penSizeSelect').value, 10) || 8;
      
      currentStroke = {
        color: color,
        size: size,
        isHighlighter: size >= 20,
        points: [{ x: normX, y: normY }]
      };
      redrawOverlay();
    } else {
      isSpotlightLaserActive = true;
      overlayCanvas.style.cursor = 'none';

      laserPos = { visible: true, x: 0.5, y: 0.5 };
      redrawOverlay();
      ipcRenderer.send('sync-laser', laserPos);
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!overlayCanvas) return;
    const rect = overlayCanvas.getBoundingClientRect();

    if (activeTool === 'pen' && isDrawing && currentStroke) {
      const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      currentStroke.points.push({ x: normX, y: normY });
      redrawOverlay();
      ipcRenderer.send('sync-annotations', { 
        pageNo: currentPage, 
        strokes: [...(annotationsMap[currentPage] || []), currentStroke] 
      });
    } else if (isSpotlightLaserActive) {
      const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

      laserPos = { visible: true, x: normX, y: normY };
      redrawOverlay();
      ipcRenderer.send('sync-laser', laserPos);
    }
  });

  const stopAction = () => {
    if (isDrawing && currentStroke) {
      isDrawing = false;
      if (!annotationsMap[currentPage]) annotationsMap[currentPage] = [];
      annotationsMap[currentPage].push(currentStroke);
      currentStroke = null;
      redrawOverlay();
      ipcRenderer.send('sync-annotations', { pageNo: currentPage, strokes: annotationsMap[currentPage] });
    }

    if (isSpotlightLaserActive || laserPos.visible) {
      isSpotlightLaserActive = false;
      laserPos.visible = false;
      overlayCanvas.style.cursor = (activeTool === 'pen') ? 'crosshair' : 'default';
      redrawOverlay();
      ipcRenderer.send('sync-laser', laserPos);
    }
  };

  window.addEventListener('mouseup', stopAction);
}

// ------------------------------------------------------------------------------
// Comprehensive Panel Layout Management
// ------------------------------------------------------------------------------
function updateOverallLayout() {
  const leftPanel = document.getElementById('leftPanel');
  const rightPanel = document.getElementById('rightPanel');
  const resizerMain = document.getElementById('resizerMain');
  const nextBox = document.getElementById('nextBox');
  const notesBox = document.querySelector('.notes-box');
  const resizerRight = document.getElementById('resizerRight');
  const timerPanel = document.getElementById('timerPanel');
  const resizerTimer = document.getElementById('resizerTimer');

  const isRightActive = isNextPanelVisible || isNotesVisible;

  if (!isCurrentPanelVisible && isRightActive) {
    leftPanel.style.display = 'none';
    resizerMain.style.display = 'none';
    rightPanel.style.display = 'flex';
    rightPanel.style.width = '100%';
    rightPanel.style.flex = '1 1 auto';
  } else if (isCurrentPanelVisible && !isRightActive) {
    leftPanel.style.display = 'flex';
    leftPanel.style.width = '100%';
    leftPanel.style.flex = '1 1 auto';
    resizerMain.style.display = 'none';
    rightPanel.style.display = 'none';
  } else if (isCurrentPanelVisible && isRightActive) {
    leftPanel.style.display = 'flex';
    leftPanel.style.width = lastLeftPanelWidth || '60%';
    leftPanel.style.flex = 'none';
    resizerMain.style.display = 'block';
    rightPanel.style.display = 'flex';
    rightPanel.style.width = '';
    rightPanel.style.flex = '1 1 auto';
  } else {
    leftPanel.style.display = 'none';
    rightPanel.style.display = 'none';
    resizerMain.style.display = 'none';
  }

  if (isNextPanelVisible && isNotesVisible) {
    nextBox.style.display = 'flex';
    nextBox.style.height = '45%';
    nextBox.style.flex = 'none';
    notesBox.style.display = 'flex';
    notesBox.style.flex = '1 1 auto';
    resizerRight.style.display = 'block';
  } else if (isNextPanelVisible) {
    nextBox.style.display = 'flex';
    nextBox.style.height = '100%';
    nextBox.style.flex = '1 1 auto';
    notesBox.style.display = 'none';
    resizerRight.style.display = 'none';
  } else if (isNotesVisible) {
    nextBox.style.display = 'none';
    notesBox.style.display = 'flex';
    notesBox.style.height = '100%';
    notesBox.style.flex = '1 1 auto';
    resizerRight.style.display = 'none';
  }

  if (isTimerVisible) {
    timerPanel.style.display = 'flex';
    resizerTimer.style.display = 'block';
  } else {
    timerPanel.style.display = 'none';
    resizerTimer.style.display = 'none';
  }

  drawTimerText();
  requestAnimationFrame(() => {
    renderAllViews();
  });
}

function toggleCurrentPanel() {
  const btn = document.getElementById('btnToggleCurrent');
  isCurrentPanelVisible = !isCurrentPanelVisible;
  if (btn) btn.classList.toggle('btn-off', !isCurrentPanelVisible);
  updateOverallLayout();
}

function toggleNextPanel() {
  const btn = document.getElementById('btnToggleNext');
  isNextPanelVisible = !isNextPanelVisible;
  if (btn) btn.classList.toggle('btn-off', !isNextPanelVisible);
  updateOverallLayout();
}

function toggleTimer() {
  const btn = document.getElementById('btnToggleTimer');
  isTimerVisible = !isTimerVisible;
  if (btn) btn.classList.toggle('btn-off', !isTimerVisible);
  updateOverallLayout();
}

function toggleTimerSidebar() {
  const sidebar = document.getElementById('timerSidebar');
  const btn = document.getElementById('btnToggleTimerSidebar');
  isTimerSidebarVisible = !isTimerSidebarVisible;
  
  if (sidebar) {
    if (isTimerSidebarVisible) {
      sidebar.classList.remove('collapsed');
      if (btn) btn.innerText = '⚙️';
    } else {
      sidebar.classList.add('collapsed');
      if (btn) btn.innerText = '⚙️ Controls';
    }
  }
  drawTimerText();
  requestAnimationFrame(() => {
    renderAllViews();
  });
}

function toggleNotes() {
  const btn = document.getElementById('btnToggleNotes');
  isNotesVisible = !isNotesVisible;
  if (btn) btn.classList.toggle('btn-off', !isNotesVisible);
  updateOverallLayout();
}

function toggleFilmstrip() {
  const container = document.getElementById('filmstripContainer');
  const btn = document.getElementById('btnToggleFilmstrip');
  isFilmstripVisible = !isFilmstripVisible;

  if (container) {
    if (isFilmstripVisible) {
      container.classList.remove('collapsed');
      container.style.height = lastFilmstripHeight || '155px';
      if (btn) btn.innerText = '▼';
    } else {
      container.classList.add('collapsed');
      if (btn) btn.innerText = '▲';
    }
  }
  drawTimerText();
  requestAnimationFrame(() => {
    renderAllViews();
  });
}

function changeNotesFontSize(delta) { setNotesFontSizeDirect(notesFontSize + delta); }

function setNotesFontSizeDirect(val) {
  notesFontSize = Math.max(6, parseInt(val) || 32);
  const txt = document.getElementById('txtNotes');
  const numInput = document.getElementById('numNotesSize');
  if (txt) txt.style.fontSize = `${notesFontSize}px`;
  if (numInput) numInput.value = notesFontSize;
}

// ------------------------------------------------------------------------------
// Countdown Timer Engine
// ------------------------------------------------------------------------------
function updateTimerFromInputs() {
  if (timerRunning) pauseTimer();
  const hr = parseInt(document.getElementById('timerHr').value) || 0;
  const min = parseInt(document.getElementById('timerMin').value) || 0;
  const sec = parseInt(document.getElementById('timerSec').value) || 0;
  remainingSec = (hr * 3600) + (min * 60) + sec;
  overtimeSec = 0;
  isOvertime = false;
  drawTimerText();
}

function formatSeconds(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return timerFormat === 'mm:ss' 
    ? `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function drawTimerText() {
  const canvas = document.getElementById('timerCanvas');
  if (!canvas || isPresentationMode || !isTimerVisible) return;
  const ctx = canvas.getContext('2d');

  const container = canvas.parentElement;
  if (!container) return;

  const cw = container.clientWidth || 200;
  const ch = container.clientHeight || 80;
  if (cw === 0 || ch === 0) return;

  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  ctx.clearRect(0, 0, cw, ch);

  const customMsg = (document.getElementById('timerCustomMsg').value || 'Time Up!!!').trim();
  const customTimerColor = document.getElementById('timerColorPicker').value || '#FFFFFF';

  if (!isOvertime) {
    const timeStr = formatSeconds(remainingSec);
    const maxW = cw * 0.88;
    const maxH = ch * 0.75;
    let fontSize = Math.min(maxH, maxW / (timeStr.length * 0.58));
    
    ctx.font = `bold ${fontSize}px Consolas, monospace`;
    while ((ctx.measureText(timeStr).width > maxW || fontSize > maxH) && fontSize > 8) {
      fontSize -= 1;
      ctx.font = `bold ${fontSize}px Consolas, monospace`;
    }

    ctx.fillStyle = remainingSec <= 60 ? '#FF0000' : customTimerColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(timeStr, cw / 2, ch / 2);
  } else {
    const pulse = (Math.sin(Date.now() / 250) + 1) / 2;
    const fadeAlpha = 0.2 + (pulse * 0.8);
    const redFadeColor = `rgba(255, 0, 0, ${fadeAlpha})`;

    const line1H = ch * 0.42;
    const line2H = ch * 0.38;

    let font1Size = Math.min(line1H, (cw * 0.85) / (customMsg.length * 0.6));
    ctx.font = `bold ${font1Size}px "Segoe UI", sans-serif`;
    while ((ctx.measureText(customMsg).width > cw * 0.85 || font1Size > line1H) && font1Size > 8) {
      font1Size -= 1;
      ctx.font = `bold ${font1Size}px "Segoe UI", sans-serif`;
    }
    ctx.fillStyle = redFadeColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(customMsg, cw / 2, ch * 0.30);

    const overtimeStr = `+${formatSeconds(overtimeSec)}`;
    let font2Size = Math.min(line2H, (cw * 0.85) / (overtimeStr.length * 0.58));
    ctx.font = `bold ${font2Size}px Consolas, monospace`;
    while ((ctx.measureText(overtimeStr).width > cw * 0.85 || font2Size > line2H) && font2Size > 8) {
      font2Size -= 1;
      ctx.font = `bold ${font2Size}px Consolas, monospace`;
    }
    ctx.fillStyle = redFadeColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(overtimeStr, cw / 2, ch * 0.75);
  }
}

function startTimerAnimationLoop() {
  if (animLoopId) cancelAnimationFrame(animLoopId);
  function loop() {
    if (timerRunning || isOvertime) {
      drawTimerText();
      animLoopId = requestAnimationFrame(loop);
    } else {
      animLoopId = null;
    }
  }
  animLoopId = requestAnimationFrame(loop);
}

function startTimer() {
  if (timerRunning) return;
  timerRunning = true;
  startTimerAnimationLoop();

  timerInterval = setInterval(() => {
    if (!isOvertime) {
      if (remainingSec > 0) {
        remainingSec--;
      } else {
        isOvertime = true;
        overtimeSec = 0;
      }
    } else {
      overtimeSec++;
    }
  }, 1000);
}

function pauseTimer() { 
  timerRunning = false; 
  clearInterval(timerInterval); 
  if (animLoopId) cancelAnimationFrame(animLoopId);
  animLoopId = null;
  drawTimerText();
}

function resetTimer() { pauseTimer(); updateTimerFromInputs(); }
function updateTimerFormat() { timerFormat = document.getElementById('timerFmt').value; drawTimerText(); }

function openFileDialog() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf';
  input.onchange = (e) => {
    if (e.target.files[0]) loadPDF(e.target.files[0].path);
  };
  input.click();
}

function togglePresentation(startPage = currentPage) {
  ipcRenderer.send('sync-transitions-map', slideTransitionsMap);
  ipcRenderer.send('toggle-presentation', startPage);
}

// ------------------------------------------------------------------------------
// Resizing Logic
// ------------------------------------------------------------------------------
function initResizablePanes() {
  if (isPresentationMode) return;

  const resizerMain = document.getElementById('resizerMain');
  const leftPanel = document.getElementById('leftPanel');

  if (resizerMain && leftPanel) {
    let x = 0, leftWidth = 0;
    const onMouseMove = (e) => {
      const dx = e.clientX - x;
      const newWidth = ((leftWidth + dx) / leftPanel.parentElement.clientWidth) * 100;
      if (newWidth > 20 && newWidth < 80) {
        leftPanel.style.width = `${newWidth}%`;
        lastLeftPanelWidth = `${newWidth}%`;
      }
    };
    const onMouseUp = () => {
      resizerMain.classList.remove('dragging');
      document.body.classList.remove('is-dragging');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      
      requestAnimationFrame(() => {
        drawTimerText();
        renderAllViews();
      });
    };
    resizerMain.addEventListener('mousedown', (e) => {
      x = e.clientX;
      leftWidth = leftPanel.getBoundingClientRect().width;
      resizerMain.classList.add('dragging');
      document.body.classList.add('is-dragging');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  const resizerTimer = document.getElementById('resizerTimer');
  const timerPanel = document.getElementById('timerPanel');

  if (resizerTimer && timerPanel) {
    let y = 0, timerHeight = 0;
    const onMouseMove = (e) => {
      const dy = e.clientY - y;
      const newH = timerHeight - dy;
      if (newH > 60 && newH < 350) {
        timerPanel.style.height = `${newH}px`;
        drawTimerText();
      }
    };
    const onMouseUp = () => {
      resizerTimer.classList.remove('dragging');
      document.body.classList.remove('is-dragging');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      requestAnimationFrame(() => {
        renderAllViews();
      });
    };
    resizerTimer.addEventListener('mousedown', (e) => {
      y = e.clientY;
      timerHeight = timerPanel.getBoundingClientRect().height;
      resizerTimer.classList.add('dragging');
      document.body.classList.add('is-dragging');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  const resizerRight = document.getElementById('resizerRight');
  const nextBox = document.getElementById('nextBox');

  if (resizerRight && nextBox) {
    let y = 0, nextHeight = 0;
    const onMouseMove = (e) => {
      const dy = e.clientY - y;
      const parentH = nextBox.parentElement.clientHeight;
      const newH = Math.max(80, Math.min(parentH - 80, nextHeight + dy));
      nextBox.style.height = `${newH}px`;
    };
    const onMouseUp = () => {
      resizerRight.classList.remove('dragging');
      document.body.classList.remove('is-dragging');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      requestAnimationFrame(() => {
        renderAllViews();
      });
    };
    resizerRight.addEventListener('mousedown', (e) => {
      y = e.clientY;
      nextHeight = nextBox.getBoundingClientRect().height;
      resizerRight.classList.add('dragging');
      document.body.classList.add('is-dragging');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  const resizerFilmstrip = document.getElementById('resizerFilmstrip');
  const filmstrip = document.getElementById('filmstrip');
  const filmstripContainer = document.getElementById('filmstripContainer');

  if (resizerFilmstrip && filmstripContainer && filmstrip) {
    let y = 0, containerHeight = 0;
    const onMouseMove = (e) => {
      const dy = e.clientY - y;
      const newH = Math.max(70, Math.min(400, containerHeight - dy));
      filmstrip.style.height = `${newH}px`;
      filmstripContainer.style.height = `${newH}px`;
      lastFilmstripHeight = `${newH}px`;
    };
    const onMouseUp = () => {
      resizerFilmstrip.classList.remove('dragging');
      document.body.classList.remove('is-dragging');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      requestAnimationFrame(() => {
        renderAllViews();
      });
    };
    resizerFilmstrip.addEventListener('mousedown', (e) => {
      if (!isFilmstripVisible) return;
      y = e.clientY;
      containerHeight = filmstripContainer.getBoundingClientRect().height;
      resizerFilmstrip.classList.add('dragging');
      document.body.classList.add('is-dragging');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }
}

// ------------------------------------------------------------------------------
// Global Event Listeners & IPC Receivers
// ------------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && (e.key === 'a' || e.key === 'A')) {
    const filmstrip = document.getElementById('filmstrip');
    if (document.activeElement === filmstrip || filmstrip.contains(document.activeElement)) {
      e.preventDefault();
      selectAllSlides();
      return;
    }
  }

  if (e.key === 'Backspace') {
    if (!['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      undoAnnotation();
      return;
    }
  }

  if (e.key === 'Escape' || e.key === 'Esc') {
    if (isPresentationMode || isPresentationActive) {
      e.preventDefault();
      ipcRenderer.send('toggle-presentation', currentPage);
      return;
    }
  }

  if (e.key === 'F11') {
    e.preventDefault();
    togglePresentation(1);
    return;
  }

  if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    return;
  }

  if (document.activeElement.tagName === 'SELECT') {
    document.activeElement.blur();
  }

  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') nextPage();
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') prevPage();
  
  if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
    e.preventDefault();
    togglePresentation(currentPage);
  }
});

window.addEventListener('resize', () => {
  drawTimerText();
  if (windowResizeTimer) clearTimeout(windowResizeTimer);
  windowResizeTimer = setTimeout(() => {
    renderAllViews();
  }, 100);
});

ipcRenderer.on('open-direct-pdf', (event, filePath) => loadPDF(filePath));
ipcRenderer.on('init-presentation-pdf', (event, data) => {
  loadPDF(data.filePath, data.pageIndex);
});

ipcRenderer.on('sync-transitions-map', (event, map) => {
  slideTransitionsMap = map || {};
  updateThumbnailSelectionUI();
});

ipcRenderer.on('sync-presentation-page', (event, data) => {
  const pageNo = typeof data === 'object' ? data.pageNo : data;
  const transType = typeof data === 'object' ? data.transition : (slideTransitionsMap[pageNo] || globalTransition || 'none');
  goToPage(pageNo, false, transType);
});

ipcRenderer.on('change-language-menu', (event, lang) => changeLanguage(lang));
ipcRenderer.on('trigger-open-file', () => openFileDialog());
ipcRenderer.on('trigger-toggle-presentation', (event, startFromFirst) => {
  togglePresentation(startFromFirst ? 1 : currentPage);
});

ipcRenderer.on('toggle-panel', (event, panelName) => {
  if (panelName === 'current') toggleCurrentPanel();
  else if (panelName === 'next') toggleNextPanel();
  else if (panelName === 'timer') toggleTimer();
  else if (panelName === 'notes') toggleNotes();
  else if (panelName === 'filmstrip') toggleFilmstrip();
});

ipcRenderer.on('receive-annotations', (event, data) => {
  annotationsMap[data.pageNo] = data.strokes;
  if (data.pageNo === currentPage) redrawOverlay();
});

ipcRenderer.on('receive-laser', (event, laserData) => {
  laserPos = laserData;
  redrawOverlay();
});

ipcRenderer.on('presentation-status', (event, isOpen) => {
  isPresentationActive = isOpen;
  const btn = document.getElementById('btnFullscreen');
  if (btn) {
    if (isOpen) {
      btn.classList.add('btn-active');
    } else {
      btn.classList.remove('btn-active');
    }
  }
});

changeLanguage('en');
setNotesFontSizeDirect(32);
drawTimerText();
initResizablePanes();
initOverlayCanvasEvents();