// ============================================================
// [BAGIAN 1] PATCH CRYPTO (WAJIB PALING ATAS)
// ============================================================
import * as crypto from 'crypto';

// Polyfill untuk crypto global dan webcrypto
if (typeof global !== 'undefined') {
    if (!global.crypto) {
        // @ts-ignore
        global.crypto = crypto as any;
    }
    
    // @ts-ignore
    if (!global.crypto.subtle && crypto.webcrypto) {
        // @ts-ignore
        global.crypto.subtle = crypto.webcrypto.subtle;
        // @ts-ignore
        global.crypto.getRandomValues = crypto.webcrypto.getRandomValues.bind(crypto.webcrypto);
    }
}
// ============================================================

import express from 'express';
import bodyParser from 'body-parser';
// ⚠️ JANGAN IMPORT BAILEYS DI SINI! (Supaya tidak kena hoisting)
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import QRCode from 'qrcode';

// --- KONFIGURASI ---
const PORT = 3000;
// Gunakan process.cwd() agar path dinamis mengikuti lokasi file .exe
const ROOT_DIR = process.cwd(); 
const DATA_DIR = path.join(ROOT_DIR, 'data');
const AUTH_DIR = path.join(DATA_DIR, 'auth_info');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const KNOWLEDGE_FILE = path.join(DATA_DIR, 'knowledge.txt');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// State Global
let qrString: string | null = null;
let connectionStatus = 'DISCONNECTED';
let sock: any = null;

// Setup Express
const app = express();
app.use(bodyParser.json());
// Serve folder public yang ada di sebelah file EXE
app.use(express.static(path.join(ROOT_DIR, 'public')));

// --- API ---
app.get('/api/config', (req, res) => {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
            const knowledge = fs.existsSync(KNOWLEDGE_FILE) ? fs.readFileSync(KNOWLEDGE_FILE, 'utf-8') : '';
            res.json({ apiKey: config.apiKey, knowledge });
        } else { res.json({}); }
    } catch (e) { res.json({}); }
});

app.post('/api/start', async (req, res) => {
    const { apiKey, knowledge } = req.body;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ apiKey }));
    fs.writeFileSync(KNOWLEDGE_FILE, knowledge);

    if (!sock) startBot(apiKey);
    res.json({ success: true });
});

app.get('/api/status', async (req, res) => {
    let qrImage = null;
    if (qrString) {
        qrImage = await QRCode.toDataURL(qrString);
    }
    res.json({ status: connectionStatus, qr: qrImage });
});

// ============================================================
// [BAGIAN 2] LOGIKA BOT (LAZY LOAD)
// ============================================================
async function startBot(apiKey: string) {
    console.log("Memulai Bot...");

    // ✅ Import Baileys
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Mocking untuk optional dependencies
    // (Baileys akan auto-fallback jika tidak ada)

    sock = makeWASocket({
        auth: state,
        logger: { level: 'silent', log: () => {} },
        browser: ["Mimin Pintar", "Chrome", "1.0"]
    });

    sock.ev.on('connection.update', (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("QR Code Muncul!");
            qrString = qr;
            connectionStatus = 'WAITING_SCAN';
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                startBot(apiKey);
            } else {
                connectionStatus = 'DISCONNECTED';
                qrString = null;
                sock = null;
                try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch(e){}
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Terhubung!');
            connectionStatus = 'CONNECTED';
            qrString = null;
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m: any) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const sender = msg.key.remoteJid;
        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (!textMessage) return;
        console.log(`Chat masuk: ${textMessage}`);

        try {
            let knowledgeBase = "";
            if (fs.existsSync(KNOWLEDGE_FILE)) knowledgeBase = fs.readFileSync(KNOWLEDGE_FILE, 'utf-8');

            const prompt = `Role: CS Mimin.\nData:\n${knowledgeBase}\n---\nUser: "${textMessage}"\nJawab sopan & singkat.`;
            
            await sock.sendPresenceUpdate('composing', sender);
            await new Promise(r => setTimeout(r, 1500));
            
            const result = await model.generateContent(prompt);
            await sock.sendMessage(sender, { text: result.response.text() });
        } catch (error) { console.error('Gagal balas:', error); }
    });
}

app.listen(PORT, async () => {
    console.log(`🚀 Dashboard siap di http://localhost:${PORT}`);
    try { 
        const open = (await import('open')).default;
        open(`http://localhost:${PORT}`); 
    } catch(e) {}
});