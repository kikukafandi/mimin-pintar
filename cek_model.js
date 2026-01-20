import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";

// Ambil API Key dari config
const CONFIG_FILE = path.join(process.cwd(), 'data', 'config.json');

if (!fs.existsSync(CONFIG_FILE)) {
    console.error("❌ File config.json tidak ditemukan!");
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
const ai = new GoogleGenerativeAI(config.apiKey);

// Daftar model yang mau ditesnode cek_model.js
const candidates = [
    // "gemini-2.5-flash",
    // "gemini-2.5-flash-lite",
    // "gemini-3-flash",
    "gemini-3-flash-preview",
    "gemma-3-12b-it",
    "gemma-3-4b-it",
    "gemma-3-27b-it",
    "gemini-2.0-flash-exp",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
    "gemini-pro"
];

// Delay supaya RPD aman
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function checkQuotaAndAvailability() {
    console.log("🔍 Memulai diagnosa Model & Kuota...\n");
    console.log("CATATAN: Script ini akan mencoba kirim 1 pesan 'Tes' ke setiap model.");
    console.log("         Ada jeda 4 detik antar tes agar tidak kena spam limit.\n");

    let recommendedModel = null;

    for (const modelName of candidates) {
        process.stdout.write(`👉 Cek ${modelName.padEnd(25)} : `);

        try {
            const model = ai.getGenerativeModel({ model: modelName });
            const result = await model.generateContent("Tes");

            if (result && result.response) {
                console.log("✅ BERHASIL (Kuota Aman)");
                if (!recommendedModel) recommendedModel = modelName;
            } else {
                console.log("⚠️ Tidak ada output (model hidup tapi aneh)");
            }

        } catch (error) {
            const msg = String(error.message || error);

            if (msg.includes("404")) {
                console.log("❌ TIDAK ADA (Not Found)");
            } else if (msg.includes("429")) {
                console.log("⚠️ ADA TAPI LIMIT 0 (Kuota Habis/Terkunci)");
            } else if (msg.includes("503") || msg.includes("Overloaded")) {
                console.log("⚠️ SERVER SIBUK (Overloaded)");
            } else {
                console.log(`❌ ERROR: ${msg.split('\n')[0]}`);
            }
        }

        await sleep(4000);
    }

    console.log("\n================================================");
    if (recommendedModel) {
        console.log(`🎉 KESIMPULAN: Gunakan model "${recommendedModel}"`);
        console.log(`   Update di src/main.ts pakai model ini.`);
    } else {
        console.log("😭 SEMUA MODEL GAGAL. Buat API Key baru di aistudio.google.com");
    }
    console.log("================================================");
}

checkQuotaAndAvailability();
