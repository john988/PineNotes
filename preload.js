const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notesApi', {
  loadNotes: () => ipcRenderer.invoke('notes:load'),
  saveNotes: appState => ipcRenderer.invoke('notes:save', appState),
  saveImage: dataUrl => ipcRenderer.invoke('notes:saveImage', dataUrl),
  exportNoteMarkdown: note => ipcRenderer.invoke('notes:exportMarkdown', note),
  exportAllMarkdown: notes => ipcRenderer.invoke('notes:exportAllMarkdown', notes),
  backupNotes: appState => ipcRenderer.invoke('notes:backup', appState),
  restoreBackup: () => ipcRenderer.invoke('notes:restoreBackup'),
  importMarkdownFiles: () => ipcRenderer.invoke('notes:importMarkdownFiles'),
  exportPdf: payload => ipcRenderer.invoke('notes:exportPdf', payload),
  printCurrentWindow: () => window.print()
});
