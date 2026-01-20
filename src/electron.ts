import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import './main'; // Ini memanggil logika bot kakak

export let mainWindow: BrowserWindow | null = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: "Mimin Pintar Dashboard",
        webPreferences: {
            // Arahkan ke hasil compile preload.js di folder dist
            preload: path.join(__dirname, '../dist/preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Load file HTML (kita buat di langkah 4)
    mainWindow.loadFile(path.join(__dirname, '../public/index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});