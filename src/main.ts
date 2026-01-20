import * as crypto from 'crypto';
if (!global.crypto) {
    // @ts-ignore
    global.crypto = {};
}
if (!global.crypto.subtle) {
    if (crypto.webcrypto) {
        // @ts-ignore
        global.crypto.subtle = crypto.webcrypto.subtle;
    } else {
        console.error("WARNING: WebCrypto API tidak ditemukan! Update Node.js Anda.");
    }
}
import express from 'express';
import bodyParser from 'body-parser';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import open from 'open';
import QRCode from 'qrcode';
import pino from 'pino';

// --- CONFIGURATION ---
const PORT = 3000;
const DATA_DIR = path.join(process.cwd(), 'data');
const AUTH_DIR = path.join(process.cwd(), 'data', 'auth_info');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const KNOWLEDGE_FILE = path.join(DATA_DIR, 'knowledge.txt');

// Pastikan folder data ada
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// --- GLOBAL STATE ---
let qrString: string | null = null;
let connectionStatus = 'DISCONNECTED';
let sock: any = null;

// --- EXPRESS APP (DASHBOARD) ---
const app = express();
app.use(bodyParser.json());
// Update path public agar kompatibel saat dibungkus PKG
// Kita asumsikan folder 'public' selalu ada di sebelah file executable
app.use(express.static(path.join(process.cwd(), 'public')));

// Endpoint: Ambil Config saat load awal
app.get('/api/config', (req, res) => {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
            const knowledge = fs.existsSync(KNOWLEDGE_FILE) ? fs.readFileSync(KNOWLEDGE_FILE, 'utf-8') : '';
            res.json({ apiKey: config.apiKey, knowledge });
        } else {
            res.json({});
        }
    } catch (e) { res.json({}); }
});

// Endpoint: Simpan & Start Bot
app.post('/api/start', async (req, res) => {
    const { apiKey, knowledge } = req.body;

    // 1. Simpan Data
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ apiKey }));
    fs.writeFileSync(KNOWLEDGE_FILE, knowledge);

    // 2. Mulai Bot WA (Jika belum jalan)
    if (!sock) {
        await startBot(apiKey);
    }

    res.json({ success: true });
});

// Endpoint: Cek Status & QR (Polling)
app.get('/api/status', async (req, res) => {
    let qrImage = null;
    if (qrString) {
        qrImage = await QRCode.toDataURL(qrString); // Convert text QR to Image Base64
    }
    res.json({ status: connectionStatus, qr: qrImage });
});

// --- LOGIKA WHATSAPP & GEMINI ---

async function startBot(apiKey: string) {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    // Setup Gemini AI
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ["Mimin Pintar", "Chrome", "1.0"]
    });

    sock.ev.on('connection.update', (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrString = qr; // Kirim ke Frontend
            connectionStatus = 'WAITING_SCAN';
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus. Reconnect?', shouldReconnect);
            if (shouldReconnect) {
                startBot(apiKey);
            } else {
                connectionStatus = 'DISCONNECTED';
                qrString = null;
                sock = null;
                // Hapus folder auth jika logout agar user bisa scan ulang
                fs.rmSync(AUTH_DIR, { recursive: true, force: true });
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

        console.log(`Pesan dari ${sender}: ${textMessage}`);

        try {
            // Baca Knowledge Base Realtime
            let knowledgeBase = "";
            if (fs.existsSync(KNOWLEDGE_FILE)) {
                knowledgeBase = fs.readFileSync(KNOWLEDGE_FILE, 'utf-8');
            }

            // System Prompt
            const prompt = `
            Bertindaklah sebagai Customer Service Profesional bernama 'Mimin'.
            Gunakan HANYA informasi berikut untuk menjawab:
            ---
            ${knowledgeBase}
            ---
            User bertanya: "${textMessage}"
            Jawab dengan ramah, singkat, dan bahasa Indonesia yang natural. Arahkan ke pembelian.
            `;

            // Kirim ke Google
            await sock.sendPresenceUpdate('composing', sender); // Efek mengetik

            // Artificial Delay (Biar gak kayak robot banget)
            await new Promise(r => setTimeout(r, 2000));

            const result = await model.generateContent(prompt);
            const response = result.response.text();

            // Balas WA
            await sock.sendMessage(sender, { text: response });

        } catch (error) {
            console.error('Error handling message:', error);
        }
    });
}

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`🚀 Dashboard siap di http://localhost:${PORT}`);
    // Open hanya jalan jika di environment desktop, di server headless kadang error, jadi kita try-catch
    try {
        open(`http://localhost:${PORT}`);
    } catch (e) {
        console.log("Silakan buka browser secara manual.");
    }
});