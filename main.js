const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

// 单实例锁定
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

let win;

function getStoragePaths() {
  const userDataPath = app.getPath('userData');
  return {
    notesFile: path.join(userDataPath, 'notes.json'),
    imagesDir: path.join(userDataPath, 'images'),
    backupDir: path.join(userDataPath, 'backups')
  };
}

async function ensureStorageReady() {
  const { imagesDir, backupDir } = getStoragePaths();
  await Promise.all([
    fs.mkdir(imagesDir, { recursive: true }),
    fs.mkdir(backupDir, { recursive: true })
  ]);
}

const DEFAULT_SETTINGS = {
  theme: 'forest',
  editorFontSize: 14,
  previewFontSize: 15,
  editorFontFamily: 'Cascadia Code, Consolas, monospace',
  previewFontFamily: 'Georgia, Cambria, serif',
  uiDensity: 'comfortable'
};

async function loadAppState() {
  const { notesFile } = getStoragePaths();
  try {
    const raw = await fs.readFile(notesFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { notes: parsed, settings: { ...DEFAULT_SETTINGS } };
    }

    return {
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) }
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { notes: [], settings: { ...DEFAULT_SETTINGS } };
    }
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
    buffer: Buffer.from(match[2], 'base64'),
    mimeType
  };
}

async function saveImageDataUrl(dataUrl) {
  await ensureStorageReady();

  const { imagesDir } = getStoragePaths();
  const { extension, buffer } = parseImageDataUrl(dataUrl);
  const fileName = `note-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const imagePath = path.join(imagesDir, fileName);

  await fs.writeFile(imagePath, buffer);

  return pathToFileURL(imagePath).href;
}

function ensureNoteLike(value) {
  return value && typeof value === 'object' && typeof value.content === 'string';
}

function sanitizeFilename(name, fallback = 'note') {
  const cleaned = String(name || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || fallback;
}

async function fileUrlToDataUrl(fileUrl) {
  const filePath = fileURLToPath(fileUrl);
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypeMap = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif'
  };

  const mimeType = mimeTypeMap[extension];
  if (!mimeType) return fileUrl;

  const buffer = await fs.readFile(filePath);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

async function inlineLocalImagesInMarkdown(markdown) {
  const matches = Array.from(markdown.matchAll(/!\[[^\]]*]\((?:<)?(file:[^)>\s]+)(?:>)?\)/g));
  if (matches.length === 0) return markdown;

  let result = markdown;
  for (const match of matches) {
    const fileUrl = match[1];
    try {
      const dataUrl = await fileUrlToDataUrl(fileUrl);
      result = result.split(fileUrl).join(dataUrl);
    } catch {
      // keep original file URL if the image cannot be read
    }
  }

  return result;
}

function replaceExtension(name, extension) {
  const parsed = path.parse(name);
  return `${parsed.name}${extension}`;
}

ipcMain.handle('notes:load', async () => {
  await ensureStorageReady();
  return loadAppState();
});

ipcMain.handle('notes:save', async (_event, appState) => {
  if (!appState || !Array.isArray(appState.notes)) {
    throw new Error('Invalid app state payload');
  }

  await ensureStorageReady();

  const { notesFile } = getStoragePaths();
  const payload = {
    notes: appState.notes,
    settings: { ...DEFAULT_SETTINGS, ...(appState.settings || {}) }
  };

  await fs.writeFile(notesFile, JSON.stringify(payload, null, 2), 'utf8');
  await pruneManagedImages(payload.notes);

  return true;
});

ipcMain.handle('notes:saveImage', async (_event, dataUrl) => {
  return saveImageDataUrl(dataUrl);
});

ipcMain.handle('notes:exportMarkdown', async (_event, note) => {
  if (!ensureNoteLike(note)) {
    throw new Error('Invalid note payload');
  }

  const defaultName = `${sanitizeFilename(note.title, 'note')}.md`;
  const result = await dialog.showSaveDialog(win, {
    title: '导出 Markdown',
    defaultPath: defaultName,
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });

  if (result.canceled || !result.filePath) return null;

  await fs.writeFile(result.filePath, note.content, 'utf8');
  return result.filePath;
});

ipcMain.handle('notes:exportAllMarkdown', async (_event, notes) => {
  if (!Array.isArray(notes)) {
    throw new Error('Invalid notes payload');
  }

  const result = await dialog.showOpenDialog(win, {
    title: '导出全部 Markdown',
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const exportDir = result.filePaths[0];
  const usedNames = new Set();
  let exportedCount = 0;

  for (const note of notes) {
    if (!ensureNoteLike(note)) continue;

    let baseName = sanitizeFilename(note.title || 'note', 'note');
    if (!baseName.toLowerCase().endsWith('.md')) baseName = `${baseName}.md`;

    let finalName = baseName;
    let suffix = 2;
    while (usedNames.has(finalName.toLowerCase())) {
      finalName = `${replaceExtension(baseName, '')}-${suffix}.md`;
      suffix += 1;
    }

    usedNames.add(finalName.toLowerCase());
    await fs.writeFile(path.join(exportDir, finalName), String(note.content || ''), 'utf8');
    exportedCount += 1;
  }

  return { directory: exportDir, exportedCount };
});

ipcMain.handle('notes:backup', async (_event, appState) => {
  const notes = Array.isArray(appState) ? appState : appState?.notes;
  const settings = Array.isArray(appState) ? { ...DEFAULT_SETTINGS } : { ...DEFAULT_SETTINGS, ...(appState?.settings || {}) };
  if (!Array.isArray(notes)) {
    throw new Error('Invalid notes payload');
  }

  await ensureStorageReady();

  const backupNotes = [];
  for (const note of notes) {
    if (!ensureNoteLike(note)) continue;
    backupNotes.push({
      ...note,
      content: await inlineLocalImagesInMarkdown(note.content)
    });
  }

  const defaultName = `pine-notes-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const result = await dialog.showSaveDialog(win, {
    title: '备份 Pine Notes',
    defaultPath: path.join(getStoragePaths().backupDir, defaultName),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });

  if (result.canceled || !result.filePath) return null;

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    notes: backupNotes,
    settings
  };

  await fs.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
  return result.filePath;
});

ipcMain.handle('notes:restoreBackup', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: '还原备份',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const raw = await fs.readFile(result.filePaths[0], 'utf8');
  const parsed = JSON.parse(raw);
  const notes = Array.isArray(parsed.notes) ? parsed.notes : [];

  const restoredNotes = [];
  for (const note of notes) {
    let content = String(note.content || '');
    const matches = Array.from(content.matchAll(/data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+/gi));
    for (const match of matches) {
      const storedUrl = await saveImageDataUrl(match[0]);
      content = content.replace(match[0], storedUrl);
    }

    restoredNotes.push({
      ...note,
      content
    });
  }

  return {
    notes: restoredNotes,
    settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) }
  };
});

ipcMain.handle('notes:importMarkdownFiles', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: '导入 Markdown',
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    properties: ['openFile', 'multiSelections']
  });

  if (result.canceled || result.filePaths.length === 0) return [];

  const imported = [];
  for (const filePath of result.filePaths) {
    const content = await fs.readFile(filePath, 'utf8');
    const fileName = replaceExtension(path.basename(filePath), '');
    const title = content.split(/\r?\n/, 1)[0].replace(/^#+\s*/, '').trim() || fileName;
    const now = Date.now();

    imported.push({
      id: `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      title,
      content,
      starred: false,
      archived: false,
      tags: [],
      history: [],
      created: now,
      updated: now
    });
  }

  return imported;
});

ipcMain.handle('notes:exportPdf', async (_event, payload) => {
  if (!payload || typeof payload.html !== 'string') {
    throw new Error('Invalid PDF payload');
  }

  const defaultName = `${sanitizeFilename(payload.title || 'note', 'note')}.pdf`;
  const result = await dialog.showSaveDialog(win, {
    title: '导出 PDF',
    defaultPath: defaultName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });

  if (result.canceled || !result.filePath) return null;

  const pdfWin = new BrowserWindow({
    show: false,
    width: 960,
    height: 1280,
    webPreferences: {
      sandbox: true
    }
  });

  const printHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${sanitizeFilename(payload.title || 'note', 'note')}</title>
<style>
body { font-family: Georgia, Cambria, serif; margin: 40px; color: #102016; line-height: 1.75; }
img { max-width: 100%; }
pre { background: #f3f6f3; padding: 16px; overflow: auto; }
code { background: #eef2ee; padding: 2px 6px; border-radius: 4px; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #d8e2d8; padding: 8px 12px; text-align: left; }
blockquote { border-left: 3px solid #4f8a67; padding-left: 16px; color: #4c6153; }
</style>
</head>
<body>${payload.html}</body>
</html>`;

  await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(printHtml)}`);
  const pdfBuffer = await pdfWin.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
  });
  await fs.writeFile(result.filePath, pdfBuffer);
  pdfWin.destroy();

  return result.filePath;
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
