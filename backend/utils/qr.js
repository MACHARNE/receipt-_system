// ============================================================
// utils/qr.js — Receipt QR codes
// ============================================================
// One place for QR options so the code on screen and the code printed in the
// PDF are identical and scannable at the same physical size.
// ============================================================

const QRCode = require("qrcode");

const OPTIONS = {
    width: 184,
    margin: 1,
    errorCorrectionLevel: "M",
};

/** PNG data URL, for <img src>. */
function qrDataUrl(text) {
    return QRCode.toDataURL(text, OPTIONS);
}

/** Raw PNG buffer, for embedding in a PDF. */
function qrPngBuffer(text) {
    return QRCode.toBuffer(text, { ...OPTIONS, type: "png" });
}

module.exports = { qrDataUrl, qrPngBuffer };
