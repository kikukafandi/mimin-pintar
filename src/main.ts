import * as crypto from 'crypto';

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
import express from 'express';
import bodyParser from 'body-parser';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import QRCode from 'qrcode';
// Import BrowserWindow untuk mengirim data ke Dashboard UI
import { BrowserWindow } from 'electron';

// --- KONFIGURASI ---
const PORT = 3000;
const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, 'data');
const AUTH_DIR = path.join(DATA_DIR, 'auth_info');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const KNOWLEDGE_FILE = path.join(DATA_DIR, 'knowledge.txt');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

// State Global
let qrString: string | null = null;
let connectionStatus = 'DISCONNECTED';
let sock: any = null;
let retryCount: number = 0;
const MAX_RETRIES: number = 3;

// Helper untuk mendapatkan jendela utama Electron
const getMainWindow = () => BrowserWindow.getAllWindows()[0];

// Setup Express
const app = express();
app.use(bodyParser.json());
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

app.post('/api/disconnect', async (req, res) => {
    try {
        if (sock) {
            await sock.logout();
            sock = null;
        }
        
        // Hapus auth credentials
        if (fs.existsSync(AUTH_DIR)) {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        }
        
        connectionStatus = 'DISCONNECTED';
        qrString = null;
        retryCount = 0;
        
        if (getMainWindow()) {
            getMainWindow().webContents.send('status-update', 'DISCONNECTED');
        }
        
        res.json({ success: true, message: 'Koneksi WhatsApp berhasil diputus' });
    } catch (error) {
        console.error('Gagal disconnect:', error);
        res.json({ success: false, error: (error as any).message });
    }
});

// ============================================================
// [BAGIAN 2] LOGIKA BOT (CORE)
// ============================================================
async function startBot(apiKey: string) {// Add this ke dalam startBot function
setInterval(() => {
    const memoryUsage = process.memoryUsage();
    console.log(`Memory Usage:
        RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)} MB
        Heap: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB / ${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB
    `);
}, 10000); // Check every 10 seconds
    console.log("Memulai Bot...");

    const baileys = await eval('import("@whiskeysockets/baileys")');
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = baileys;
    // MOCK LOGGER
    const logger: any = {
        level: 'silent',
        trace: () => { },
        debug: () => { },
        info: () => { },
        warn: () => { },
        error: () => { },
        fatal: () => { },
    };
    logger.child = () => logger;

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemma-3-4b-it" });

    // Cek apakah sudah ada credentials valid
    const hasValidCreds = state.creds && state.creds.me && state.creds.me.id;

    if (!hasValidCreds) {
        console.log("⏳ Belum ada credentials. Generate QR untuk scan...");
    }

    sock = makeWASocket({
        auth: state,
        logger: logger,
        // printQRInTerminal: true,
        browser: ["Mimin Pintar", "Chrome", "1.0"],
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 60_000,
        retryRequestDelayMs: 250,
        maxRetries: 2,
        version: [2, 3031, 9]
    });

    // --- LOGIC KONEKSI ---
    sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("QR Code Muncul! Scan sekarang.");
            qrString = qr;
            connectionStatus = 'WAITING_SCAN';
            retryCount = 0; // Reset counter saat QR muncul
            if (getMainWindow()) getMainWindow().webContents.send('qr-update', qr);
        }

        if (connection === 'close') {
            // Ambil kode status error
            const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`Koneksi terputus (Status: ${statusCode}). Reconnect: ${shouldReconnect}`);

            // Status 405 = Unauthorized - cek apakah auth kosong
            if (statusCode === 405) {
                const authExists = fs.existsSync(AUTH_DIR) && fs.readdirSync(AUTH_DIR).length > 0;
                
                if (!authExists) {
                    // Auth kosong = belum ada credentials, ini normal saat awal
                    retryCount++;
                    if (retryCount > MAX_RETRIES) {
                        console.log("❌ Max retries terpenuhi. Silakan restart aplikasi dan scan QR baru.");
                        connectionStatus = 'FAILED';
                        if (getMainWindow()) getMainWindow().webContents.send('status-update', 'FAILED');
                        return;
                    }
                    
                    const delayMs = 5000 + (retryCount * 3000); // 8s, 11s, 14s
                    console.log(`⏳ Menunggu ${delayMs / 1000}s sebelum retry (attempt ${retryCount}/${MAX_RETRIES})...`);
                    setTimeout(() => startBot(apiKey), delayMs);
                } else {
                    // Auth ada tapi error 405 = session expired/invalid
                    console.log("⚠️ Error 405 dengan auth existing - Menghapus sesi lama...");
                    connectionStatus = 'DISCONNECTED';
                    if (getMainWindow()) getMainWindow().webContents.send('status-update', 'DISCONNECTED');
                    
                    try {
                        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                    } catch (e) {
                        console.error("Gagal hapus folder auth:", e);
                    }
                    
                    retryCount = 0;
                    setTimeout(() => startBot(apiKey), 3000);
                }
            } else if (shouldReconnect) {
                retryCount = 0;
                console.log("Mencoba menyambung ulang dalam 5 detik...");
                setTimeout(() => startBot(apiKey), 5000);
            } else {
                console.log("User Log Out! Menghapus sesi...");
                connectionStatus = 'DISCONNECTED';
                if (getMainWindow()) getMainWindow().webContents.send('status-update', 'DISCONNECTED');

                try {
                    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                } catch (e) {
                    console.error("Gagal hapus folder auth:", e);
                }
                
                retryCount = 0;
                setTimeout(() => startBot(apiKey), 2000);
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Terhubung!');
            connectionStatus = 'CONNECTED';
            qrString = null;
            retryCount = 0;
            if (getMainWindow()) getMainWindow().webContents.send('status-update', 'CONNECTED');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- ERROR HANDLER ---
    sock.ev.on('connection.error', (error: any) => {
        console.error("❌ Connection error:", error?.message || error);
    });

    // --- LOGIKA PESAN MASUK ---
    sock.ev.on('messages.upsert', async (m: any) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;
        const pushName = msg.pushName || "Kak";

        if (!textMessage) return;
        console.log(`Chat masuk dari ${pushName}: ${textMessage}`);

        // 🔥 KIRIM CHAT KE DASHBOARD SECARA REAL-TIME
        if (getMainWindow()) {
            getMainWindow().webContents.send('new-message', {
                sender: pushName,
                text: textMessage,
                time: new Date().toLocaleTimeString()
            });
        }

        try {
            let knowledgeBase = "Belum ada informasi produk.";
            if (fs.existsSync(KNOWLEDGE_FILE)) {
                knowledgeBase = fs.readFileSync(KNOWLEDGE_FILE, 'utf-8');
            }

            const prompt = `
[PERAN UTAMA]
Kamu adalah "Mimin Pintar", Customer Service (CS) yang profesional, ramah, dan sangat membantu.
Tujuanmu adalah membantu pelanggan dan MENDORONG PENJUALAN (Closing) secara halus.

[SUMBER DATA (DATABASE)]
${knowledgeBase}

[ATURAN PENJAWABAN WAJIB]
1. 🛡️ **ANTI HALUSINASI:** Jawab HANYA berdasarkan [SUMBER DATA] di atas. Jika user bertanya sesuatu yang TIDAK ADA di data, katakan: "Maaf Kak, Mimin belum punya info soal itu 🙏" (Jangan mengarang jawaban dari internet/pengetahuan umum).
2. ⚡ **ANTI BASA-BASI:** JANGAN menyapa "Halo/Hai" di setiap chat. Langsung jawab ke inti pertanyaan user agar percakapan efisien.
3. 😊 **TONE SUARA:** Gunakan bahasa Indonesia yang santai, akrab, tapi sopan (Style WhatsApp). Panggil user dengan "Kak". Boleh pakai singkatan wajar (yg, gak, oke, siap).
4. 📱 **FORMAT CHAT:** Jangan kirim paragraf panjang. Pecah jawaban jadi kalimat pendek-pendek. Gunakan emoji (✅, 📦, 💰, 👉) untuk poin-poin penting agar enak dibaca di HP.
5. 🎯 **CALL TO ACTION:** Jika user bertanya harga atau produk, akhiri jawaban dengan tawaran menarik. Contoh: "Mau Mimin bantu buat pesanan sekarang, Kak? 😊".

-----------------------------------
[PESAN MASUK DARI USER]
"${textMessage}"

[JAWABAN MIMIN]
`;

            await sock.sendPresenceUpdate('composing', sender);
            await new Promise(r => setTimeout(r, 1200));

            const result = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE }
                ]
            });

            const replyText = result.response.text();
            await sock.sendMessage(sender, { text: replyText });

        } catch (error) {
            console.error('Gagal balas:', error);
            if (JSON.stringify(error).includes("429")) {
                await sock.sendMessage(sender, { text: "Waduh, Mimin lagi pusing (Limit Kuota Habis). Besok chat lagi ya Kak! 🙏" });
            }
        }
    });
}

// Start Internal Server
app.listen(PORT, async () => {
    console.log(`🚀 Server Internal siap di http://localhost:${PORT}`);
});