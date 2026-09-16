// ============================================================
// js/receipt-view.js — View a receipt
// ============================================================

const navUser = document.getElementById("navUser");
const toastContainer = document.getElementById("toastContainer");
const pageAlert = document.getElementById("pageAlert");

let receiptId = null;
let receiptData = null;

function toast(msg, type = "success") {
    const el = document.createElement("div");
    el.className = `toast align-items-center text-bg-${type} border-0`;
    el.role = "alert";
    el.innerHTML = `<div class="d-flex">
        <div class="toast-body">${escapeHtml(msg)}</div>
        <button class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>`;
    toastContainer.appendChild(el);
    new bootstrap.Toast(el, { delay: 3500 }).show();
    el.addEventListener("hidden.bs.toast", () => el.remove());
}
function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
        "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
}
function money(n) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 }); }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString() : "—"; }
function showAlert(msg, type = "danger") {
    pageAlert.className = `alert alert-${type}`;
    pageAlert.textContent = msg;
    pageAlert.classList.remove("d-none");
}
function pickTextColor(hex) {
    let h = String(hex || "#0d6efd").replace("#", "");
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const toLin = v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    const L = 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
    return L > 0.55 ? "#111827" : "#ffffff";
}

// ---------- Auth ----------
let currentUser = null;
(async function guard() {
    try {
        const { user } = await api.get("/auth/me");
        currentUser = user;
        if (currentUser.role === "super_admin") { window.location.href = "/superadmin-dashboard.html"; return; }
        navUser.textContent = currentUser.fullName || "";
    } catch { window.location.href = "/index.html"; }
})();

document.getElementById("logoutBtn").addEventListener("click", async () => {
    try { await api.post("/auth/logout"); } catch {}
    window.location.href = "/index.html";
});

// ---------- Load ----------
(async function boot() {
    const params = new URLSearchParams(window.location.search);
    receiptId = parseInt(params.get("id"), 10);
    if (!receiptId) {
        showAlert("No receipt ID specified.");
        return;
    }
    await load();
})();

async function load() {
    try {
        const data = await api.get(`/receipts/${receiptId}`);
        receiptData = data;
        render();
    } catch (err) {
        showAlert(err.message || "Failed to load receipt.");
    }
}

function render() {
    const { receipt, items, field_values, company, theme_base_color, qr_code } = receiptData;

    document.getElementById("receiptSummary").textContent =
        `${receipt.receipt_number} · ${receipt.type_name}`;

    // Header
    const header = document.getElementById("receiptHeader");
    const base = theme_base_color || "#0d6efd";
    header.style.background = base;
    header.style.color = pickTextColor(base);

    document.getElementById("companyName").textContent = company.name || "—";
    document.getElementById("companyAddress").textContent = company.address || "";
    document.getElementById("companyContact").textContent =
        [company.phone, company.email].filter(Boolean).join(" · ");
    document.getElementById("receiptNumber").textContent = receipt.receipt_number;
    const logo = document.getElementById("companyLogo");
    if (company.logo_path) {
        logo.src = `/company/logo?t=${Date.now()}`;
        logo.classList.remove("d-none");
    }
    document.getElementById("receiptDate").textContent = fmtDate(receipt.payment_date || receipt.created_at);

    // Customer + type
    document.getElementById("rcCustomer").textContent = receipt.customer_name || "—";
    document.getElementById("rcCustomerPhone").textContent = receipt.customer_phone || "";
    // Dynamic fields
    const dfBlock = document.getElementById("dynamicFieldsBlock");
    const dfKeys = Object.keys(field_values || {});
    if (dfKeys.length) {
        dfBlock.innerHTML = `<div class="row g-2">` + dfKeys.map(k => `
            <div class="col-md-4">
              <div class="text-muted small">${escapeHtml(k.replace(/_/g, " "))}</div>
              <div style="font-weight:500;">${escapeHtml(field_values[k])}</div>
            </div>`).join("") + `</div>`;
    } else {
        dfBlock.innerHTML = "";
    }

    // Items
    document.getElementById("rcItemsBody").innerHTML = items.map(it => `
      <tr>
        <td>${escapeHtml(it.item_name)}</td>
        <td class="text-end">${Number(it.quantity)}</td>
        <td class="text-end">${money(it.unit_price)}</td>
        <td class="text-end fw-semibold">${money(it.line_total)}</td>
      </tr>`).join("");

    document.getElementById("rcSubtotal").textContent = money(receipt.subtotal);
    document.getElementById("rcDiscount").textContent = money(receipt.discount_amount);
    document.getElementById("rcTotal").textContent = money(receipt.total);
    document.getElementById("rcPaid").textContent = money(receipt.amount_paid);
    document.getElementById("rcBalance").textContent = money(receipt.balance);
    document.getElementById("rcMethod").textContent = receipt.payment_method || "—";
    document.getElementById("rcFooter").textContent = company.receipt_footer || "";
    const qr = document.getElementById("receiptQr");
    if (qr_code) qr.src = qr_code;
    else document.getElementById("qrBlock").classList.add("d-none");

    // Void button — only if allowed and not already void
    if (["owner","admin"].includes(currentUser?.role) && receipt.status !== "void") {
        const vb = document.getElementById("voidBtn");
        vb.classList.remove("d-none");
        vb.addEventListener("click", handleVoid);
    }
    if (new URLSearchParams(window.location.search).get("print") === "1") {
        window.setTimeout(() => window.print(), 300);
    }
}

async function handleVoid() {
    const reason = prompt("Why are you voiding this receipt? (required)");
    if (!reason || !reason.trim()) return;
    if (!confirm("This cannot be undone. Void this receipt?")) return;
    try {
        await api.post(`/receipts/${receiptId}/void`, { reason: reason.trim() });
        toast("Receipt voided.");
        await load();
    } catch (err) {
        toast(err.message || "Failed to void.", "danger");
    }
}

document.getElementById("printBtn").addEventListener("click", () => {
    window.print();
});
