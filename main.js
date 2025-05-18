import { app, BrowserWindow, ipcMain } from 'electron';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let windows = [];

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenu(null);

  win.loadFile('index.html');

  win.lastInteraction = Date.now();

  win.on('focus', () => {
    win.lastInteraction = Date.now();
  });

  windows.push(win);

  win.on('closed', () => {
    windows = windows.filter(w => w !== win);
  });

  return win;
}

function tryGC() {
  if (global.gc) {
    console.log('[Memory Manager] Forçando garbage collection (GC)...');
    global.gc();
  } else {
    console.warn('[Memory Manager] GC não está exposto. Rode o Electron com --expose-gc para usar esta função.');
  }
}

async function clearWindowCache(win) {
  if (win && !win.isDestroyed()) {
    try {
      await win.webContents.session.clearCache();
      console.log('[Memory Manager] Cache limpo da janela');
    } catch (e) {
      console.error('[Memory Manager] Erro ao limpar cache:', e);
    }
  }
}

function closeIdleWindows(maxIdleTimeMs = 5 * 60 * 1000) {
  const now = Date.now();
  windows.forEach(win => {
    if (!win.isDestroyed() && now - win.lastInteraction > maxIdleTimeMs) {
      console.log('[Memory Manager] Fechando janela ociosa');
      win.close();
    }
  });
}

function monitorMemoryAdvanced({
  thresholdMB = 500,
  checkIntervalMs = 30 * 1000,
  idleWindowTimeMs = 5 * 60 * 1000,
}) {
  setInterval(async () => {
    const memInfo = await process.getProcessMemoryInfo();

    const usedMB = memInfo.private / 1024;
    console.log(`[Memory Manager] Uso RAM main process: ${usedMB.toFixed(2)} MB`);

    if (usedMB > thresholdMB) {
      console.warn(`[Memory Manager] Uso de memória ultrapassou ${thresholdMB} MB!`);

      tryGC();

      for (const win of windows) {
        if (!win.isDestroyed()) {
          await clearWindowCache(win);
          // Envia evento para o renderer liberar memória extra
          win.webContents.send('memory-manager-clear-unused-data');
        }
      }
    }

    closeIdleWindows(idleWindowTimeMs);
  }, checkIntervalMs);
}

ipcMain.on('memory-manager-cleared', (event) => {
  console.log('[Memory Manager] Renderer avisou que liberou memória');
});

app.whenReady()
  .then(() => {
    createWindow();
    monitorMemoryAdvanced({
      thresholdMB: 500,
      checkIntervalMs: 30 * 1000,
      idleWindowTimeMs: 5 * 60 * 1000,
    });

    app.on('activate', () => {
      if (windows.length === 0) createWindow();
    });
  })
  .catch(console.error);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
