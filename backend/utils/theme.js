// ============================================================
// utils/theme.js — WCAG-safe color computation
// ============================================================
// Given a base color (any hex), returns a full theme:
//   - header_bg        the base color
//   - header_text      computed for maximum contrast (white or near-black)
//   - accent_bg        a soft tint of the base (for total boxes)
//   - accent_text      text color on the accent
//   - border           thin border derived from base
//   - body_text        always readable (#111827)
//   - muted_text       always readable (#6b7280)
// ============================================================

// ------------------------------------------------------------
// Parse "#RRGGBB" or "#RGB" into { r, g, b }
// ------------------------------------------------------------
function parseHex(hex) {
    if (typeof hex !== "string") return { r: 13, g: 110, b: 253 };
    let h = hex.trim().replace("#", "");
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) {
        return { r: 13, g: 110, b: 253 };   // fallback blue
    }
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
    };
}

function toHex({ r, g, b }) {
    const h = (n) => Math.max(0, Math.min(255, Math.round(n)))
                        .toString(16).padStart(2, "0");
    return "#" + h(r) + h(g) + h(b);
}

// ------------------------------------------------------------
// WCAG relative luminance
// ------------------------------------------------------------
function luminance({ r, g, b }) {
    const srgb = [r, g, b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

// ------------------------------------------------------------
// Pick black or white text for max contrast
// ------------------------------------------------------------
function pickTextColor(bgRgb) {
    const contrast = hex => {
        const a = luminance(bgRgb), b = luminance(parseHex(hex));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const dark = contrast('#111827'), white = contrast('#ffffff');
    if (Math.max(dark, white) < 4.5) return '#000000';
    return dark >= white ? '#111827' : '#ffffff';
}

// ------------------------------------------------------------
// Blend toward white (lighten) or toward black (darken)
// t = 0 → unchanged, t = 1 → pure white/black
// ------------------------------------------------------------
function blendToward({ r, g, b }, target, t) {
    return {
        r: r + (target - r) * t,
        g: g + (target - g) * t,
        b: b + (target - b) * t,
    };
}

// ------------------------------------------------------------
// Public API: build a full theme from a base color
// ------------------------------------------------------------
function buildTheme(baseHex, overrides = {}) {
    const base = parseHex(baseHex);

    // Header: base bg, contrast-safe text
    const header_bg = toHex(base);
    let header_text = pickTextColor(base);
    if (typeof overrides.header_text_color === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(overrides.header_text_color)) {
        const candidate = parseHex(overrides.header_text_color);
        const a = luminance(base), b = luminance(candidate);
        if ((Math.max(a,b) + 0.05) / (Math.min(a,b) + 0.05) >= 4.5) header_text = toHex(candidate);
    }

    // Accent: base blended strongly toward white → soft tint
    const accent_bg = typeof overrides.accent_color === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(overrides.accent_color)
        ? overrides.accent_color
        : toHex(blendToward(base, 255, 0.92));   // 92% toward white

    // Border: base blended 75% toward white
    const border = toHex(blendToward(base, 255, 0.75));

    return {
        base_color: header_bg,
        header_bg,
        header_text_color: header_text,
        accent_bg,
        accent_text: pickTextColor(parseHex(accent_bg)),       // same logic — safe either way
        border,
        body_text: "#111827",           // never themed
        muted_text: "#6b7280",          // never themed
        soft_danger_bg: "#fee2e2",
        soft_danger_text: "#991b1b",
        soft_success_bg: "#d1fae5",
        soft_success_text: "#065f46",
    };
}

module.exports = { buildTheme, parseHex, toHex, luminance, pickTextColor };