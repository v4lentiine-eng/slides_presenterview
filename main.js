const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron');
const path = require('path');

let mainWindow = null;
let presentationWindow = null;
let currentPdfPath = null;
let currentTransitionsMap = {};

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
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // ขยายหน้าต่างหลักให้เต็มหน้าจอ Desktop ตั้งแต่เริ่มเปิดโปรแกรม
  mainWindow.maximize();

  mainWindow.loadFile('index.html');

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

  // ค้นหา Display 2 (จอนอก) หากไม่พบจะ Fallback กลับมาใช้ Primary Display
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
  Menu.setApplicationMenu(null);

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