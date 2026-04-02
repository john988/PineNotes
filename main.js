const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');

// 单实例锁定
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

let win;

function getStoragePaths() {
  const userDataPath = app.getPath('userData');
  return {
    notesFile: path.join(userDataPath, 'notes.json'),
    imagesDir: path.join(userDataPath, 'images')
  };
}

async function ensureStorageReady() {
  const { imagesDir } = getStoragePaths();
  await fs.mkdir(imagesDir, { recursive: true });
}

async function loadNotes() {
  const { notesFile } = getStoragePaths();
  try {
    const raw = await fs.readFile(notesFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function pruneManagedImages(notes) {
  const { imagesDir } = getStoragePaths();
  const serializedNotes = JSON.stringify(notes);
  const entries = await fs.readdir(imagesDir, { withFileTypes: true });

  await Promise.all(entries.map(async entry => {
    if (!entry.isFile() || !entry.name.startsWith('note-image-')) return;

    const imagePath = path.join(imagesDir, entry.name);
    const imageUrl = pathToFileURL(imagePath).href;

    if (!serializedNotes.includes(imageUrl)) {
      await fs.unlink(imagePath);
    }
  }));
}

function parseImageDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i.exec(dataUrl || '');
  if (!match) {
    throw new Error('Unsupported image payload');
  }

  const mimeType = match[1].toLowerCase();
  const extensionMap = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif'
  };

  return {
    extension: extensionMap[mimeType],
    buffer: Buffer.from(match[2], 'base64')
  };
}

ipcMain.handle('notes:load', async () => {
  await ensureStorageReady();
  return loadNotes();
});

ipcMain.handle('notes:save', async (_event, notes) => {
  if (!Array.isArray(notes)) {
    throw new Error('Invalid notes payload');
  }

  await ensureStorageReady();

  const { notesFile } = getStoragePaths();
  await fs.writeFile(notesFile, JSON.stringify(notes, null, 2), 'utf8');
  await pruneManagedImages(notes);

  return true;
});

ipcMain.handle('notes:saveImage', async (_event, dataUrl) => {
  await ensureStorageReady();

  const { imagesDir } = getStoragePaths();
  const { extension, buffer } = parseImageDataUrl(dataUrl);
  const fileName = `note-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const imagePath = path.join(imagesDir, fileName);

  await fs.writeFile(imagePath, buffer);

  return pathToFileURL(imagePath).href;
});

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 680,
    minHeight: 480,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0d1a12',
      symbolColor: '#9aafa1',
      height: 36
    },
    backgroundColor: '#080f0b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadFile('index.html');

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    win = null;
  });
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  await ensureStorageReady();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
