// ============================================================
// middleware/uploadImport.js — Multer config for CSV/XLSX imports
// ============================================================
// Stores files in backend/uploads/imports/ temporarily.
// Only CSV is accepted in v1.
// ============================================================

const multer = require("multer");
const path = require("path");
const fs = require("fs");

const IMPORT_DIR = path.join(__dirname, "..", "uploads", "imports");
if (!fs.existsSync(IMPORT_DIR)) fs.mkdirSync(IMPORT_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, IMPORT_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const unique = `import-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
        cb(null, unique);
    },
});

function fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const okMime =
        file.mimetype === "text/csv" ||
        file.mimetype === "application/vnd.ms-excel" ||
        file.mimetype === "application/octet-stream";
    const okExt = ext === ".csv";
    if (!okMime || !okExt) {
        return cb(new Error("Only .csv files are allowed."));
    }
    cb(null, true);
}

const uploadImport = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 },   // 5 MB
});

module.exports = { uploadImport, IMPORT_DIR };