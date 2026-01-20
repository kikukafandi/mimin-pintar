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
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import QRCode from 'qrcode';

// --- KONFIGURASI ---
const PORT = 3000;
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
// [BAGIAN 2] LOGIKA BOT (CORE)
// ============================================================
async function startBot(apiKey: string) {
    console.log("Memulai Bot...");

    // Import Dinamis Baileys (Wajib agar .exe tidak crash)
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = await import('@whiskeysockets/baileys');

    // MOCK LOGGER
    const logger: any = {
        level: 'silent',
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
    };
    logger.child = () => logger; 

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemma-3-4b-it" });

    sock = makeWASocket({
        auth: state,
        logger: logger, 
        printQRInTerminal: true,
        browser: ["Mimin Pintar", "Chrome", "1.0"]
    });

    // --- LOGIC KONEKSI ---
    sock.ev.on('connection.update', (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("QR Code Muncul! Scan sekarang.");
            qrString = qr;
            connectionStatus = 'WAITING_SCAN';
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus. Reconnect:', shouldReconnect);
            
            if (shouldReconnect) {
                startBot(apiKey);
            } else {
                console.log("User Log Out! Menghapus sesi dan restart...");
                connectionStatus = 'DISCONNECTED';
                qrString = null;
                sock = null;

                try {
                    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                } catch (e) {
                    console.error("Gagal hapus folder auth:", e);
                }

                startBot(apiKey);
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Terhubung!');
            connectionStatus = 'CONNECTED';
            qrString = null;
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- LOGIKA PESAN MASUK ---
    sock.ev.on('messages.upsert', async (m: any) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        
        const sender = msg.key.remoteJid;
        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;
        const pushName = msg.pushName || "Kak"; 

        if (!textMessage) return;
        console.log(`Chat masuk dari ${pushName}: ${textMessage}`);

        try {
            let knowledgeBase = "Belum ada informasi produk.";
            if (fs.existsSync(KNOWLEDGE_FILE)) {
                knowledgeBase = fs.readFileSync(KNOWLEDGE_FILE, 'utf-8');
            }

            // ========================================================
            // 🔥 PROMPT OPTIMIZED (AGAR JAWABAN LEBIH TERKONDISI) 🔥
            // ========================================================
            const prompt = `
[PERAN UTAMA]
Kamu adalah "Mimin Pintar", Customer Service (CS) toko online yang profesional, ramah, dan sangat membantu.
Tujuanmu adalah membantu pelanggan dan MENDORONG PENJUALAN (Closing) secara halus.

[SUMBER DATA (DATABASE)]
${knowledgeBase}

[ATURAN PENJAWABAN WAJIB]
1. 🛡️ **ANTI HALUSINASI:** Jawab HANYA berdasarkan [SUMBER DATA] di atas. Jika user bertanya sesuatu yang TIDAK ADA di data, katakan: "Maaf Kak, Mimin belum punya info soal itu 🙏" (Jangan mengarang jawaban dari internet/pengetahuan umum).
2. ⚡ **ANTI BASA-BASI:** JANGAN menyapa "Halo/Hai" di setiap chat. Langsung jawab ke inti pertanyaan user agar percakapan efisien.
3. 😊 **TONE SUARA:** Gunakan bahasa Indonesia yang santai, akrab, tapi sopan (Style WhatsApp). Panggil user dengan "Kak". Boleh pakai singkatan wajar (yg, gak, oke, siap).
4. 📱 **FORMAT CHAT:** Jangan kirim paragraf panjang. Pecah jawaban jadi kalimat pendek-pendek. Gunakan emoji (✅, 📦, 💰, 👉) untuk poin-poin penting agar enak dibaca di HP.
5. 🎯 **CALL TO ACTION:** Jika user bertanya harga atau produk, akhiri jawaban dengan tawaran menarik. Contoh: "Mau Mimin bantu buat pesanan sekarang, Kak? 😊".

[CONTOH PERCAKAPAN]
User: "Harganya berapa?"
Mimin: "Untuk paket ini harganya cuma Rp 50.000 aja Kak 💰. Barangnya ready stok lho, mau dibungkus sekarang?"

User: "Lokasi dimana?"
Mimin: "Toko kami ada di Jakarta Pusat ya Kak. Bisa kirim via Gojek/Grab juga kok 🛵."

-----------------------------------
[PESAN MASUK DARI USER]
"${textMessage}"

[JAWABAN MIMIN]
`;
            
            await sock.sendPresenceUpdate('composing', sender);
            await new Promise(r => setTimeout(r, 1200)); // Delay natural
            
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
            // Handling Limit
            if (JSON.stringify(error).includes("429")) {
               await sock.sendMessage(sender, { text: "Waduh, Mimin lagi pusing (Limit Kuota Habis). Besok chat lagi ya Kak! 🙏" });
            }
        }
    });
}

// Open v8 Logic
app.listen(PORT, async () => {
    console.log(`🚀 Dashboard siap di http://localhost:${PORT}`);
    try { 
        const open = require('open'); 
        open(`http://localhost:${PORT}`); 
    } catch(e) {
        console.log("Gagal auto-open browser (Abaikan jika di server).");
    }
});