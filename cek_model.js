const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");

// Ambil API Key dari config
const CONFIG_FILE = path.join(process.cwd(), 'data', 'config.json');

if (!fs.existsSync(CONFIG_FILE)) {
    console.error("❌ File config.json tidak ditemukan!");
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
const genAI = new GoogleGenerativeAI(config.apiKey);

// Daftar model yang mau dites (Urutkan dari yang paling diinginkan)
const candidates = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3-flash",
    "gemma-3-12b-it",
    "gemma-3-4b-it",
    "gemma-3-27b-it",
    "gemini-2.0-flash-exp",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
    "gemini-pro" // Versi 1.0 (Cadangan terakhir)
];

// Fungsi Delay supaya RPD tidak jebol saat checking
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function checkQuotaAndAvailability() {
    console.log("🔍 Memulai diagnosa Model & Kuota...\n");
    console.log("CATATAN: Script ini akan mencoba kirim 1 pesan 'Tes' ke setiap model.");
    console.log("         Ada jeda 4 detik antar tes agar tidak kena spam limit.\n");

    let recommendedModel = null;

    for (const modelName of candidates) {
        process.stdout.write(`👉 Cek ${modelName.padEnd(25)} : `);

        try {
            // 1. Inisialisasi Model
            const model = genAI.getGenerativeModel({ model: modelName });

            // 2. Coba Generate (Test Drive)
            // Menggunakan maxOutputTokens 1 supaya hemat token response
            const result = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: "Tes" }] }],
                generationConfig: { maxOutputTokens: 1 }
            });
            
            await result.response; // Tunggu respon full

            // Jika sampai sini, berarti SUKSES
            console.log("✅ BERHASIL (Kuota Aman)");
            
            // Simpan model pertama yang berhasil sebagai rekomendasi utama
            if (!recommendedModel) recommendedModel = modelName;

        } catch (error) {
            // Analisa Error
            if (error.message.includes("404")) {
                console.log("❌ TIDAK ADA (Not Found)");
            } else if (error.message.includes("429")) {
                console.log("⚠️ ADA TAPI LIMIT 0 (Kuota Habis/Terkunci)");
            } else if (error.message.includes("503") || error.message.includes("Overloaded")) {
                console.log("⚠️ SERVER SIBUK (Overloaded)");
            } else {
                console.log(`❌ ERROR LAIN: ${error.message.split('[')[0]}`);
            }
        }

        // Jeda 4 detik sebelum lanjut ke model berikutnya
        // (Gemini Flash limitnya 15 RPM = 1 request tiap 4 detik)
        await sleep(4000); 
    }

    console.log("\n================================================");
    if (recommendedModel) {
        console.log(`🎉 KESIMPULAN: Gunakan model "${recommendedModel}"`);
        console.log(`   Silakan update 'src/main.ts' dengan nama model tersebut.`);
    } else {
        console.log("😭 SEMUA MODEL GAGAL. Coba buat API Key baru di aistudio.google.com");
    }
    console.log("================================================");
}

checkQuotaAndAvailability();