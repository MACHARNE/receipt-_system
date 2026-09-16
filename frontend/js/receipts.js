// ============================================================
// js/receipts.js — Receipt list
// ============================================================

let receipts = [];
let pagination = { page: 1, pageSize: 25, total: 0, totalPages: 0 };
const filters = { q: "", receipt_type_id: "", status: "", payment_method: "", date_from: "", date_to: "" };

const navUser = document.getElementById("navUser");
const toastContainer = document.getElementById("toastContainer");
const receiptsBody = document.getElementById("receiptsBody");
const paginationInfo = document.getElementById("paginationInfo");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");

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

(async function guard() {
    try {
        const { user: me } = await api.get("/auth/me");
        if (me.role === "super_admin") { window.location.href = "/superadmin-dashboard.html"; return; }
        navUser.textContent = me.fullName || "";
    } catch { window.location.href = "/index.html"; }
})();

document.getElementById("logoutBtn").addEventListener("click", async () => {
    try { await api.post("/auth/logout"); } catch {}
    window.location.href = "/index.html";
});

async function loadReceipts() {
    receiptsBody.innerHTML = `<tr><td colspan="8" class="empty-state">
        <div class="spinner-border spinner-border-sm"></div>
    </td></tr>`;

    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    params.set("page", pagination.page);
    params.set("pageSize", pagination.pageSize);

    try {
        const data = await api.get("/receipts?" + params.toString());
        receipts = data.receipts;
        pagination = data.pagination;
        render();
    } catch (err) {
        receiptsBody.innerHTML = `<tr><td colspan="8" class="empty-state text-danger">
            ${escapeHtml(err.message || "Failed to load.")}
        </td></tr>`;
    }
}

async function loadReceiptTypes() {
    try {
        const data = await api.get("/receipts/next-options");
        const select = document.getElementById("filterType");
        select.innerHTML = `<option value="">All receipt types</option>` +
            data.types.map(type => `<option value="${type.id}">${escapeHtml(type.name)}</option>`).join("");
    } catch { /* Receipt search remains usable if types cannot load. */ }
}

function render() {
    if (receipts.length === 0) {
        receiptsBody.innerHTML = `<tr><td colspan="8" class="empty-state">
            <i class="bi bi-receipt"></i>
            <div>No receipts found</div>
            <div class="small">Click <strong>New Receipt</strong> to create one.</div>
        </td></tr>`;
        renderPagination();
        return;
    }

    receiptsBody.innerHTML = receipts.map(r => {
        const badge = ({
            paid:    "badge-soft-success",
            partial: "badge-soft-warning",
            unpaid:  "badge-soft-danger",
            void:    "badge-soft-muted",
        }[r.status] || "badge-soft-muted");

        return `
          <tr>
            <td><code>${escapeHtml(r.receipt_number)}</code></td>
            <td>
              <div class="fw-semibold">${escapeHtml(r.customer_name || "—")}</div>
              <div class="text-muted small">${escapeHtml(r.customer_phone || "")}</div>
            </td>
            <td class="d-none d-md-table-cell">${escapeHtml(r.type_name)}</td>
            <td class="text-end fw-semibold">${money(r.total)}</td>
            <td class="text-end d-none d-lg-table-cell">${money(r.amount_paid)}</td>
            <td class="text-end d-none d-lg-table-cell">${money(r.balance)}</td>
            <td><span class="badge ${badge}">${r.status.toUpperCase()}</span></td>
            <td class="text-end">
              <a href="/receipt-view.html?id=${r.id}" class="btn btn-sm btn-outline-secondary">
                <i class="bi bi-eye"></i>
              </a>
            </td>
          </tr>`;
    }).join("");

    renderPagination();
}

function renderPagination() {
    const from = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
    const to = Math.min(pagination.page * pagination.pageSize, pagination.total);
    paginationInfo.textContent = `Showing ${from}–${to} of ${pagination.total}`;
    prevPageBtn.disabled = pagination.page <= 1;
    nextPageBtn.disabled = pagination.page >= pagination.totalPages;
}

let searchTimer;
document.getElementById("searchInput").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        filters.q = e.target.value;
        pagination.page = 1;
        loadReceipts();
    }, 300);
});
document.getElementById("filterStatus").addEventListener("change", (e) => {
    filters.status = e.target.value; pagination.page = 1; loadReceipts();
});
document.getElementById("filterType").addEventListener("change", (e) => {
    filters.receipt_type_id = e.target.value; pagination.page = 1; loadReceipts();
});
document.getElementById("filterMethod").addEventListener("change", (e) => {
    filters.payment_method = e.target.value; pagination.page = 1; loadReceipts();
});
document.getElementById("filterFrom").addEventListener("change", (e) => {
    filters.date_from = e.target.value; pagination.page = 1; loadReceipts();
});
document.getElementById("filterTo").addEventListener("change", (e) => {
    filters.date_to = e.target.value; pagination.page = 1; loadReceipts();
});
prevPageBtn.addEventListener("click", () => { if (pagination.page > 1) { pagination.page--; loadReceipts(); } });
nextPageBtn.addEventListener("click", () => { if (pagination.page < pagination.totalPages) { pagination.page++; loadReceipts(); } });

loadReceiptTypes();
loadReceipts();
