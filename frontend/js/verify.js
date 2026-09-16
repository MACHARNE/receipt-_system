// ============================================================
// js/verify.js — Public receipt verification page
// ============================================================
// The page is served at /verify/<token>, so the token is read from the path
// (with a ?token= fallback for a direct visit to /verify.html). It then asks
// /verify/<token>/data and renders the result.
//
// This is a public page: it shows only what the server chooses to disclose.
// ============================================================

const loadingBlock = document.getElementById("stateLoading");
const resultBlock = document.getElementById("stateResult");
const iconEl = document.getElementById("resultIcon");
const titleEl = document.getElementById("resultTitle");
const messageEl = document.getElementById("resultMessage");
const detailsEl = document.getElementById("resultDetails");

function tokenFromUrl() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const index = parts.indexOf("verify");
    if (index !== -1 && parts[index + 1]) {
        return decodeURIComponent(parts[index + 1]);
    }
    return new URLSearchParams(window.location.search).get("token") || "";
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}

function money(value) {
    return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2 });
}

function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

const STATUS_STYLES = {
    PAID:    "background:#dcfce7;color:#166534;",
    PARTIAL: "background:#fef3c7;color:#92400e;",
    UNPAID:  "background:#e5e7eb;color:#374151;",
    ISSUED:  "background:#dbeafe;color:#1e40af;",
    VOID:    "background:#fee2e2;color:#991b1b;",
};

function statusPill(status) {
    const style = STATUS_STYLES[status] || "background:#e5e7eb;color:#374151;";
    return `<span class="status-pill" style="${style}">${escapeHtml(status || "UNKNOWN")}</span>`;
}

function showOutcome({ icon, colour, title, message, details }) {
    loadingBlock.classList.add("d-none");

    iconEl.innerHTML = `<i class="bi ${icon}" style="color:${colour};"></i>`;
    titleEl.textContent = title;
    messageEl.textContent = message;
    resultBlock.classList.remove("d-none");

    if (details && details.length) {
        detailsEl.innerHTML = details
            .map(([label, value]) => `
              <div class="verify-row">
                <span class="verify-label">${escapeHtml(label)}</span>
                <span class="verify-value">${value}</span>
              </div>`)
            .join("");
        detailsEl.classList.remove("d-none");
    }
}

function showNotFound(message) {
    showOutcome({
        icon: "bi-x-octagon",
        colour: "#dc3545",
        title: "Not Verified",
        message: message || "No receipt matches this code.",
    });
}

(async function boot() {
    const token = tokenFromUrl();

    if (!token) {
        showNotFound("This link is missing a verification code.");
        return;
    }

    let response;
    let data;
    try {
        response = await fetch(`/verify/${encodeURIComponent(token)}/data`, {
            headers: { Accept: "application/json" },
            credentials: "same-origin",
        });
        data = await response.json().catch(() => ({}));
    } catch {
        showOutcome({
            icon: "bi-wifi-off",
            colour: "#dc3545",
            title: "Could Not Check",
            message: "We could not reach the server. Please try again.",
        });
        return;
    }

    if (!response.ok || !data.found) {
        showNotFound(data.message);
        return;
    }

    const details = [
        ["Company", escapeHtml(data.company || "—")],
        ["Receipt Number", escapeHtml(data.receipt_number || "—")],
        ["Date", escapeHtml(formatDate(data.date))],
        ["Amount Paid", escapeHtml(money(data.amount_paid))],
        ["Status", statusPill(data.status)],
    ];

    if (data.verified) {
        showOutcome({
            icon: "bi-patch-check-fill",
            colour: "#198754",
            title: "Receipt Verified",
            message: "This receipt was issued by the company named below.",
            details,
        });
    } else {
        showOutcome({
            icon: "bi-exclamation-triangle-fill",
            colour: "#dc3545",
            title: "Receipt Found — Void",
            message: data.message || "This receipt is no longer valid.",
            details,
        });
    }
})();
