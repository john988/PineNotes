const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notesApi', {
  loadNotes: () => ipcRenderer.invoke('notes:load'),
  saveNotes: notes => ipcRenderer.invoke('notes:save', notes),
  saveImage: dataUrl => ipcRenderer.invoke('notes:saveImage', dataUrl)
});
