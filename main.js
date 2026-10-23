const { app, BrowserWindow, ipcMain, Menu, screen, dialog } = require('electron');
const path = require('path');

let mainWindow = null;
let presentationWindow = null;
let currentPdfPath = null;
let currentTransitionsMap = {};

const iconPath = path.join(__dirname, 'icon.png');

// ------------------------------------------------------------------------------
// Command Line & Open-With File Parser
// ------------------------------------------------------------------------------

function getPdfFromArgs(argv) {
  if (!argv || !Array.isArray(argv)) return null;
  return argv.find(arg => typeof arg === 'string' && arg.toLowerCase().endsWith('.pdf'));
}

const initialPdfPath = getPdfFromArgs(process.argv);
if (initialPdfPath) {
  currentPdfPath = path.resolve(initialPdfPath);
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const openWithPdf = getPdfFromArgs(commandLine);
    if (openWithPdf) {
      currentPdfPath = path.resolve(openWithPdf);
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('open-direct-pdf', currentPdfPath);
      }
    }
  });
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  currentPdfPath = path.resolve(filePath);
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('open-direct-pdf', currentPdfPath);
  }
});

// ------------------------------------------------------------------------------
// Native Menu Bar Creation
// ------------------------------------------------------------------------------

function createApplicationMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        {
          label: 'About Slides Presenterview',
          click: () => showAboutDialog()
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open PDF...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            if (mainWindow && mainWindow.webContents) {
              mainWindow.webContents.send('trigger-open-file');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Start/Stop Presentation Mode',
          accelerator: 'CmdOrCtrl+L',
          click: () => {
            if (mainWindow && mainWindow.webContents) {
              mainWindow.webContents.send('trigger-toggle-presentation', false);
            }
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Current Panel',
          click: () => mainWindow && mainWindow.webContents.send('toggle-panel', 'current')
        },
        {
          label: 'Toggle Next Panel',
          click: () => mainWindow && mainWindow.webContents.send('toggle-panel', 'next')
        },
        {
          label: 'Toggle Timer Panel',
          click: () => mainWindow && mainWindow.webContents.send('toggle-panel', 'timer')
        },
        {
          label: 'Toggle Speaker Notes Panel',
          click: () => mainWindow && mainWindow.webContents.send('toggle-panel', 'notes')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Language',
      submenu: [
        {
          label: 'English',
          click: () => mainWindow && mainWindow.webContents.send('change-language-menu', 'en')
        },
        {
          label: 'ไทย (Thai)',
          click: () => mainWindow && mainWindow.webContents.send('change-language-menu', 'th')
        },
        {
          label: '中文 (Chinese)',
          click: () => mainWindow && mainWindow.webContents.send('change-language-menu', 'zh')
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Slides Presenterview Help',
          click: () => showHelpDialog()
        },
        { type: 'separator' },
        {
          label: 'About Slides Presenterview',
          click: () => showAboutDialog()
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function showHelpDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Slides Presenterview Help',
    message: 'Quick Guide & Shortcuts',
    detail: '• Arrow Keys / Space / PageUp / PageDown: Navigate slides\n' +
            '• Logitech Spotlight Pointer: Hold pointer button to activate laser pointer centered on Current Slide\n' +
            '• Ctrl + L / Cmd + L: Toggle Fullscreen Presentation Mode\n' +
            '• Shift / Ctrl + Click (Filmstrip): Select multiple slides for batch transitions\n' +
            '• Ctrl + A (Filmstrip Focused): Select all slides\n' +
            '• Backspace: Undo last drawing annotation\n' +
            '• Right Click (Current Slide): Clear all drawings on current slide'
  });
}

function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About Slides Presenterview',
    message: 'Slides Presenterview',
    detail: 'Version: 1.0.1\n' +
            'A Cross-Platform Electron PDF Presenter View Application\n' +
            'Supports Windows 10/11, macOS, and Linux.'
  });
}

// ------------------------------------------------------------------------------
// Window Management
// ------------------------------------------------------------------------------

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0F0F12',
    title: 'Slides Presenterview',
    icon: iconPath,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.maximize();
  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('did-finish-load', () => {
    if (currentPdfPath) {
      mainWindow.webContents.send('open-direct-pdf', currentPdfPath);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (presentationWindow && !presentationWindow.isDestroyed()) {
      presentationWindow.close();
    }
  });
}

function createPresentationWindow(startPage = 1) {
  if (presentationWindow && !presentationWindow.isDestroyed()) {
    presentationWindow.focus();
    return;
  }

  const displays = screen.getAllDisplays();
  const targetDisplay = displays.find((display) => {
    return display.bounds.x !== 0 || display.bounds.y !== 0;
  }) || screen.getPrimaryDisplay();

  presentationWindow = new BrowserWindow({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y,
    width: targetDisplay.bounds.width,
    height: targetDisplay.bounds.height,
    fullscreen: true,
    backgroundColor: '#000000',
    title: 'Presentation',
    icon: iconPath,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  presentationWindow.loadFile('index.html', { query: { mode: 'presentation' } });

  presentationWindow.webContents.on('did-finish-load', () => {
    if (currentPdfPath) {
      presentationWindow.webContents.send('init-presentation-pdf', {
        filePath: currentPdfPath,
        pageIndex: startPage
      });
    }

    if (Object.keys(currentTransitionsMap).length > 0) {
      presentationWindow.webContents.send('sync-transitions-map', currentTransitionsMap);
    }
  });

  presentationWindow.on('closed', () => {
    presentationWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('presentation-status', false);
    }
  });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('presentation-status', true);
  }
}

// ------------------------------------------------------------------------------
// App Lifecycle
// ------------------------------------------------------------------------------

app.whenReady().then(() => {
  createApplicationMenu();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ------------------------------------------------------------------------------
// IPC Synchronization Listeners
// ------------------------------------------------------------------------------

ipcMain.on('set-current-pdf', (event, filePath) => {
  currentPdfPath = filePath;
  if (presentationWindow && !presentationWindow.isDestroyed()) {
    presentationWindow.webContents.send('open-direct-pdf', filePath);
  }
});

ipcMain.on('toggle-presentation', (event, startPage = 1) => {
  if (presentationWindow && !presentationWindow.isDestroyed()) {
    presentationWindow.close();
  } else {
    createPresentationWindow(startPage);
  }
});

ipcMain.on('sync-transitions-map', (event, map) => {
  currentTransitionsMap = map || {};

  if (presentationWindow && !presentationWindow.isDestroyed() && event.sender !== presentationWindow.webContents) {
    presentationWindow.webContents.send('sync-transitions-map', currentTransitionsMap);
  }

  if (mainWindow && !mainWindow.isDestroyed() && event.sender !== mainWindow.webContents) {
    mainWindow.webContents.send('sync-transitions-map', currentTransitionsMap);
  }
});

ipcMain.on('sync-page', (event, data) => {
  const sender = event.sender;

  if (mainWindow && sender === mainWindow.webContents && presentationWindow && !presentationWindow.isDestroyed()) {
    presentationWindow.webContents.send('sync-presentation-page', data);
  } else if (presentationWindow && sender === presentationWindow.webContents && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync-presentation-page', data);
  }
});

ipcMain.on('sync-annotations', (event, data) => {
  const sender = event.sender;

  if (mainWindow && sender === mainWindow.webContents && presentationWindow && !presentationWindow.isDestroyed()) {
    presentationWindow.webContents.send('receive-annotations', data);
  } else if (presentationWindow && sender === presentationWindow.webContents && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('receive-annotations', data);
  }
});

ipcMain.on('sync-laser', (event, laserData) => {
  if (presentationWindow && !presentationWindow.isDestroyed()) {
    presentationWindow.webContents.send('receive-laser', laserData);
  }
});