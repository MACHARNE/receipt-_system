// ============================================================
// utils/pdf.js — Server-side receipt PDF
// ============================================================
// Renders the same receipt the screen shows, honouring the company's branding
// and the per-receipt-type theme colour (with contrast-safe header text from
// utils/theme.js).
//
// Design notes:
//   - The document is built into a Buffer rather than streamed, so a failure
//     mid-render can still be reported as a clean error instead of a truncated
//     download.
//   - Amounts are formatted exactly like the on-screen receipt (grouped, two
//     decimals, no symbol). The currency is stated once, above the totals,
//     because PDFKit's built-in fonts cannot render symbols such as NGN's.
//   - PDFKit embeds PNG and JPEG only, but logo uploads also accept WebP, so a
//     logo that cannot be embedded is skipped rather than failing the receipt.
// ============================================================

const PDFDocument = require("pdfkit");
const fs = require("node:fs");
const path = require("node:path");

const { buildTheme } = require("./theme");
const { qrPngBuffer } = require("./qr");

const LOGO_DIRECTORY = path.join(__dirname, "..", "uploads", "logos");
const PAGE_MARGIN = 40;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2;      // A4 width in points
const PAGE_BOTTOM = 801;                             // A4 height minus the bottom margin

// ------------------------------------------------------------
// Formatting helpers — kept in sync with js/receipt-view.js
// ------------------------------------------------------------
function formatAmount(value) {
    const n = Number(value || 0);
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function humaniseKey(key) {
    return String(key).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ------------------------------------------------------------
// Logo handling
// ------------------------------------------------------------
function readLogoBuffer(logoPath) {
    if (!logoPath) return null;
    const safe = path.basename(logoPath);
    const extension = path.extname(safe).toLowerCase();
    // PDFKit supports PNG and JPEG only; WebP logos are skipped on purpose.
    if (![".png", ".jpg", ".jpeg"].includes(extension)) return null;
    try {
        return fs.readFileSync(path.join(LOGO_DIRECTORY, safe));
    } catch {
        return null;
    }
}

// ------------------------------------------------------------
// Build the PDF
// ------------------------------------------------------------
/**
 * @param {{receipt: object, items: object[], field_values: object,
 *          company: object, theme_base_color: string|null}} bundle
 * @param {{verifyUrl?: string}} [options]
 * @returns {Promise<Buffer>}
 */
async function buildReceiptPdf(bundle, options = {}) {
    const { receipt, items = [], field_values: fieldValues = {}, company = {}, theme_base_color: baseColor } = bundle;
    const theme = buildTheme(baseColor || "#0d6efd");
    const currency = (company.default_currency || "").trim().toUpperCase();
    const isVoid = receipt.status === "void";
    const logoBuffer = readLogoBuffer(company.logo_path);

    // The QR code is produced asynchronously, so it must exist before the
    // document is laid out. A QR failure must not cost the user their receipt.
    let qrBuffer = null;
    if (options.verifyUrl) {
        try {
            qrBuffer = await qrPngBuffer(options.verifyUrl);
        } catch (err) {
            console.error("Receipt PDF: could not build the verification QR code:", err.message);
        }
    }

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: "A4",
            margin: PAGE_MARGIN,
            info: {
                Title: `Receipt ${receipt.receipt_number}`,
                Author: company.name || "Receipt System",
                Subject: receipt.type_name || "Receipt",
            },
        });

        const chunks = [];
        doc.on("data", chunk => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        let y = PAGE_MARGIN;

        // ---------- watermark ----------
        if (company.use_logo_watermark && logoBuffer) {
            doc.save();
            doc.opacity(0.06);
            doc.image(logoBuffer, PAGE_MARGIN, 180, {
                fit: [CONTENT_WIDTH, 420],
                align: "center",
                valign: "center",
            });
            doc.restore();
            doc.opacity(1);
        }

        // ---------- header band ----------
        const bandHeight = 92;
        doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, bandHeight).fill(theme.header_bg);
        doc.fillColor(theme.header_text_color);

        const align = ["left", "center", "right"].includes(company.header_position)
            ? company.header_position
            : "left";

        let textX = PAGE_MARGIN + 16;
        let textWidth = CONTENT_WIDTH - 32;
        let bandTextY = y + 20;

        if (logoBuffer) {
            const logoBox = 64;
            const logoX = align === "center"
                ? PAGE_MARGIN + (CONTENT_WIDTH - logoBox) / 2
                : PAGE_MARGIN + 16;
            try {
                doc.image(logoBuffer, logoX, y + 16, { fit: [logoBox, logoBox] });
                if (align === "center") {
                    bandTextY = y + 16 + logoBox + 6;      // stack under the logo
                } else if (align === "left") {
                    textX = logoX + logoBox + 12;
                    textWidth = CONTENT_WIDTH - 32 - (logoBox + 12);
                } else {
                    textWidth = CONTENT_WIDTH - 32 - (logoBox + 12);
                }
            } catch {
                // Unreadable image: carry on without it rather than failing.
            }
        }

        doc.font("Helvetica-Bold").fontSize(16)
           .text(company.name || "Receipt", textX, bandTextY, { width: textWidth, align });

        doc.font("Helvetica").fontSize(9);
        const addressLines = [company.address, [company.phone, company.email].filter(Boolean).join(" · ")]
            .filter(Boolean);
        addressLines.forEach(line => {
            doc.text(line, textX, doc.y + 1, { width: textWidth, align });
        });
        if (company.tin || company.cac_number) {
            const ids = [company.tin && `TIN: ${company.tin}`, company.cac_number && `CAC: ${company.cac_number}`]
                .filter(Boolean).join("   ");
            doc.text(ids, textX, doc.y + 1, { width: textWidth, align });
        }

        y += bandHeight + 14;

        // ---------- receipt identity row ----------
        doc.fillColor(theme.body_text).font("Helvetica-Bold").fontSize(12)
           .text(receipt.type_name || "Receipt", PAGE_MARGIN, y, { width: CONTENT_WIDTH / 2 });

        doc.font("Helvetica").fontSize(9).fillColor(theme.muted_text)
           .text(`No: ${receipt.receipt_number}`, PAGE_MARGIN, y, { width: CONTENT_WIDTH, align: "right" })
           .text(`Date: ${formatDate(receipt.payment_date || receipt.created_at)}`,
                 PAGE_MARGIN, y + 12, { width: CONTENT_WIDTH, align: "right" });

        y += 30;

        doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + CONTENT_WIDTH, y)
           .lineWidth(1).strokeColor(theme.border).stroke();
        y += 12;

        // ---------- void banner ----------
        if (isVoid) {
            doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, 46).fill("#fee2e2");
            doc.fillColor("#991b1b").font("Helvetica-Bold").fontSize(13)
               .text("VOIDED — THIS RECEIPT IS NO LONGER VALID", PAGE_MARGIN + 10, y + 8,
                     { width: CONTENT_WIDTH - 20 });
            doc.font("Helvetica").fontSize(8);
            const voidInfo = [
                receipt.voided_at && `Voided: ${formatDate(receipt.voided_at)}`,
                receipt.voided_by_name && `By: ${receipt.voided_by_name}`,
                receipt.void_status_reason || receipt.void_reason,
            ].filter(Boolean).join("   ");
            if (voidInfo) doc.text(voidInfo, PAGE_MARGIN + 10, y + 27, { width: CONTENT_WIDTH - 20 });
            y += 56;
        }

        // ---------- helpers for the flowing body ----------
        // Returns true when a new page was started, so callers can repeat any
        // table header that the reader would otherwise lose.
        const ensureSpace = (needed) => {
            if (y + needed <= PAGE_BOTTOM) return false;
            doc.addPage();
            y = PAGE_MARGIN;
            return true;
        };

        const sectionLabel = (text) => {
            ensureSpace(26);
            doc.font("Helvetica-Bold").fontSize(8).fillColor(theme.muted_text)
               .text(String(text).toUpperCase(), PAGE_MARGIN, y, { width: CONTENT_WIDTH, characterSpacing: 0.5 });
            y = doc.y + 4;
        };

        // ---------- customer ----------
        const customerLines = [
            receipt.customer_name,
            receipt.customer_phone,
            receipt.customer_email,
            receipt.customer_ref && `Ref: ${receipt.customer_ref}`,
        ].filter(Boolean);

        if (customerLines.length) {
            sectionLabel("Customer");
            doc.font("Helvetica").fontSize(10).fillColor(theme.body_text);
            customerLines.forEach(line => {
                ensureSpace(16);
                doc.text(line, PAGE_MARGIN, y, { width: CONTENT_WIDTH });
                y = doc.y + 2;
            });
            y += 6;
        }

        // ---------- dynamic fields ----------
        const fieldKeys = Object.keys(fieldValues);
        if (fieldKeys.length) {
            sectionLabel("Details");
            const columnWidth = CONTENT_WIDTH / 2;
            let column = 0;
            let rowTop = y;

            fieldKeys.forEach(key => {
                const value = fieldValues[key];
                if (value === null || value === undefined || value === "") return;

                if (column === 0) {
                    ensureSpace(30);
                    rowTop = y;
                }
                const x = PAGE_MARGIN + column * columnWidth;

                doc.font("Helvetica").fontSize(7.5).fillColor(theme.muted_text)
                   .text(humaniseKey(key), x, rowTop, { width: columnWidth - 10 });
                doc.font("Helvetica").fontSize(9.5).fillColor(theme.body_text)
                   .text(String(value), x, rowTop + 10, { width: columnWidth - 10, height: 26, ellipsis: true });

                if (column === 1 || key === fieldKeys[fieldKeys.length - 1]) {
                    y = Math.max(doc.y, rowTop + 22) + 8;
                    column = 0;
                } else {
                    column = 1;
                }
            });
            y += 4;
        }

        // ---------- items ----------
        sectionLabel("Items");

        const columns = [
            { key: "item_name", label: "Item",       x: PAGE_MARGIN,                    width: 240, align: "left"  },
            { key: "quantity",  label: "Qty",        x: PAGE_MARGIN + 240,              width: 50,  align: "right" },
            { key: "unit_price",label: "Unit Price", x: PAGE_MARGIN + 290,              width: 95,  align: "right" },
            { key: "line_total",label: "Total",      x: PAGE_MARGIN + 385,              width: 130, align: "right" },
        ];

        const drawItemHeader = () => {
            ensureSpace(30);
            doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, 20).fill(theme.accent_bg);
            doc.fillColor(theme.accent_text).font("Helvetica-Bold").fontSize(8);
            columns.forEach(c => doc.text(c.label, c.x + 4, y + 6, { width: c.width - 8, align: c.align }));
            y += 20;
        };

        ensureSpace(26);
        drawItemHeader();

        if (!items.length) {
            doc.font("Helvetica").fontSize(9).fillColor(theme.muted_text)
               .text("No line items.", PAGE_MARGIN + 4, y + 7, { width: CONTENT_WIDTH - 8 });
            y += 26;
        }

        items.forEach((item, index) => {
            const descriptionHeight = item.description ? 12 : 0;
            const rowHeight = 18 + descriptionHeight;

            // Always keep the item name together with its own row.
            if (ensureSpace(rowHeight + 2)) drawItemHeader();

            if (index % 2 === 1) {
                doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, rowHeight).fill("#f9fafb");
            }

            doc.fillColor(theme.body_text).font("Helvetica").fontSize(9);
            doc.text(item.item_name || "—", columns[0].x + 4, y + 5,
                     { width: columns[0].width - 8, height: 12, ellipsis: true });
            if (item.description) {
                doc.fontSize(7.5).fillColor(theme.muted_text)
                   .text(item.description, columns[0].x + 4, y + 16,
                         { width: columns[0].width - 8, height: 10, ellipsis: true });
                doc.fontSize(9).fillColor(theme.body_text);
            }

            doc.text(String(Number(item.quantity)), columns[1].x + 4, y + 5,
                     { width: columns[1].width - 8, align: "right" });
            doc.text(formatAmount(item.unit_price), columns[2].x + 4, y + 5,
                     { width: columns[2].width - 8, align: "right" });
            doc.font("Helvetica-Bold").text(formatAmount(item.line_total), columns[3].x + 4, y + 5,
                     { width: columns[3].width - 8, align: "right" });
            doc.font("Helvetica");

            y += rowHeight;
            doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + CONTENT_WIDTH, y)
               .lineWidth(0.5).strokeColor(theme.border).stroke();
        });

        y += 14;

        // ---------- totals ----------
        const totalsWidth = 250;
        const totalsX = PAGE_MARGIN + CONTENT_WIDTH - totalsWidth;
        const totals = [
            ["Subtotal", formatAmount(receipt.subtotal)],
            ["Discount", formatAmount(receipt.discount_amount)],
        ];
        if (receipt.discount_type === "percent" && Number(receipt.discount_value)) {
            totals[1][0] = `Discount (${Number(receipt.discount_value)}%)`;
        }

        const paymentRows = [
            ["Amount Paid", formatAmount(receipt.amount_paid)],
            ["Balance", formatAmount(receipt.balance)],
        ];

        const totalsHeight = 26 + totals.length * 15 + 24 + paymentRows.length * 15;
        ensureSpace(totalsHeight + 10);

        doc.rect(totalsX, y, totalsWidth, totalsHeight).fill(theme.accent_bg);
        let totalsY = y + 8;

        if (currency) {
            doc.fillColor(theme.accent_text).font("Helvetica").fontSize(7.5)
               .text(`Amounts in ${currency}`, totalsX + 10, totalsY, { width: totalsWidth - 20, align: "right" });
            totalsY += 12;
        }

        const drawTotalsRow = (label, value, bold = false) => {
            doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9)
               .fillColor(theme.accent_text);
            doc.text(label, totalsX + 10, totalsY, { width: totalsWidth - 110, align: "left" });
            doc.text(value, totalsX + 10, totalsY, { width: totalsWidth - 20, align: "right" });
            totalsY += bold ? 18 : 15;
        };

        totals.forEach(([label, value]) => drawTotalsRow(label, value));
        doc.moveTo(totalsX + 10, totalsY - 2).lineTo(totalsX + totalsWidth - 10, totalsY - 2)
           .lineWidth(0.5).strokeColor(theme.accent_text).stroke();
        totalsY += 3;
        drawTotalsRow("Total", formatAmount(receipt.total), true);
        paymentRows.forEach(([label, value]) => drawTotalsRow(label, value));

        y += totalsHeight + 16;

        // ---------- payment ----------
        const paymentInfo = [
            ["Method", receipt.payment_method || "—"],
            ["Reference", receipt.payment_reference || "—"],
            ["Payment date", formatDate(receipt.payment_date)],
            ["Status", String(receipt.status || "").toUpperCase()],
        ];
        sectionLabel("Payment");
        const payColumnWidth = CONTENT_WIDTH / 2;
        paymentInfo.forEach(([label, value], index) => {
            const x = PAGE_MARGIN + (index % 2) * payColumnWidth;
            const rowY = y + Math.floor(index / 2) * 26;
            doc.font("Helvetica").fontSize(7.5).fillColor(theme.muted_text)
               .text(label.toUpperCase(), x, rowY, { width: payColumnWidth - 10 });
            doc.font("Helvetica").fontSize(9.5).fillColor(theme.body_text)
               .text(String(value), x, rowY + 10, { width: payColumnWidth - 10, height: 14, ellipsis: true });
        });
        y += Math.ceil(paymentInfo.length / 2) * 26 + 10;

        // ---------- notes ----------
        if (receipt.notes) {
            sectionLabel("Notes");
            doc.font("Helvetica").fontSize(9).fillColor(theme.body_text)
               .text(receipt.notes, PAGE_MARGIN, y, { width: CONTENT_WIDTH });
            y = doc.y + 12;
        }

        // ---------- verification ----------
        if (options.verifyUrl) {
            const qrSize = 84;
            ensureSpace(qrSize + 40);
            sectionLabel("Verification");

            if (qrBuffer) {
                doc.image(qrBuffer, PAGE_MARGIN, y, { fit: [qrSize, qrSize] });
            }

            const textLeft = PAGE_MARGIN + (qrBuffer ? qrSize + 12 : 0);
            const textWidth = CONTENT_WIDTH - (qrBuffer ? qrSize + 12 : 0);

            doc.font("Helvetica").fontSize(8).fillColor(theme.muted_text)
               .text("Scan this code to confirm the receipt is genuine.", textLeft, y + 6, { width: textWidth });
            doc.font("Helvetica").fontSize(8).fillColor(theme.body_text)
               .text(options.verifyUrl, textLeft, y + 22,
                     { width: textWidth, link: options.verifyUrl, underline: true });
            doc.font("Helvetica").fontSize(7.5).fillColor(theme.muted_text)
               .text(`Verification code: ${receipt.verification_token}`, textLeft, y + 40, { width: textWidth });

            y += qrSize + 16;
        }

        // ---------- issued by + signature ----------
        ensureSpace(90);
        const signatureWidth = 200;
        doc.moveTo(PAGE_MARGIN + CONTENT_WIDTH - signatureWidth, y + 30)
           .lineTo(PAGE_MARGIN + CONTENT_WIDTH, y + 30)
           .lineWidth(0.5).strokeColor(theme.border).stroke();
        doc.font("Helvetica").fontSize(8).fillColor(theme.muted_text)
           .text("Authorised signature", PAGE_MARGIN + CONTENT_WIDTH - signatureWidth, y + 34,
                 { width: signatureWidth, align: "right" });

        doc.font("Helvetica").fontSize(8).fillColor(theme.muted_text)
           .text("Issued by", PAGE_MARGIN, y, { width: CONTENT_WIDTH - signatureWidth - 20 });
        doc.font("Helvetica").fontSize(9.5).fillColor(theme.body_text)
           .text(receipt.created_by_name || "—", PAGE_MARGIN, y + 10,
                 { width: CONTENT_WIDTH - signatureWidth - 20 });
        y += 58;

        // ---------- footer ----------
        if (company.receipt_footer) {
            ensureSpace(30);
            doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(theme.muted_text)
               .text(company.receipt_footer, PAGE_MARGIN, y, { width: CONTENT_WIDTH, align: "center" });
            y = doc.y + 6;
        }

        // Flows with the content rather than being pinned to the page edge, so
        // it can never be drawn on top of the items table.
        ensureSpace(16);
        doc.font("Helvetica").fontSize(7).fillColor(theme.muted_text)
           .text(`${receipt.receipt_number}  ·  generated ${formatDate(new Date())}`,
                 PAGE_MARGIN, y, { width: CONTENT_WIDTH, align: "center" });

        doc.end();
    });
}

module.exports = { buildReceiptPdf, formatAmount, formatDate };
