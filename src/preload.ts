import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    onUpdateQR: (callback: (qr: string) => void) => ipcRenderer.on('qr-update', (_event, qr) => callback(qr)),
    onUpdateStatus: (callback: (status: string) => void) => ipcRenderer.on('status-update', (_event, status) => callback(status)),
    onNewMessage: (callback: (msg: any) => void) => ipcRenderer.on('new-message', (_event, msg) => callback(msg))
});