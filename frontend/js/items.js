// ============================================================
// js/items.js — Items & Services page
// ============================================================

// ---------- State ----------
let state = {
    items: [],
    categories: [],
    usage: { used: 0, max: 0, remaining: 0 },
    pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 },
    filters: { q: "", category_id: "", status: "" },
    editingItem: null,
    importFile: null,
    importValidated: null,
};

let currentUser = null;

// ---------- Refs ----------
const itemsBody     = document.getElementById("itemsBody");
const usageLine     = document.getElementById("usageLine");
const navUser       = document.getElementById("navUser");
const toastContainer= document.getElementById("toastContainer");

const searchInput       = document.getElementById("searchInput");
const filterCategory    = document.getElementById("filterCategory");
const filterStatus      = document.getElementById("filterStatus");
const clearFiltersBtn   = document.getElementById("clearFiltersBtn");
const prevPageBtn       = document.getElementById("prevPageBtn");
const nextPageBtn       = document.getElementById("nextPageBtn");
const paginationInfo    = document.getElementById("paginationInfo");

const itemModal       = new bootstrap.Modal("#itemModal");
const categoriesModal = new bootstrap.Modal("#categoriesModal");
const importModal     = new bootstrap.Modal("#importModal");

// ---------- Utils ----------
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
function money(n) {
    return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function setAlert(id, msg, type = "danger") {
    const el = document.getElementById(id);
    el.className = `alert alert-${type}`;
    el.textContent = msg;
    el.classList.remove("d-none");
}
function clearAlert(id) { document.getElementById(id).classList.add("d-none"); }

// ---------- Auth ----------
(async function guard() {
    try {
        currentUser = await api.get("/auth/me");
        if (currentUser.role === "super_admin") {
            window.location.href = "/superadmin-dashboard.html";
            return;
        }
        navUser.textContent = currentUser.fullName || "";
    } catch {
        window.location.href = "/index.html";
    }
})();

document.getElementById("logoutBtn").addEventListener("click", async () => {
    try { await api.post("/auth/logout"); } catch {}
    window.location.href = "/index.html";
});

// ============================================================
// LOAD
// ============================================================
async function loadCategories() {
    try {
        const { categories } = await api.get("/categories");
        state.categories = categories;
        renderCategoryOptions();
        renderCategoriesTable();
    } catch (err) {
        toast(err.message || "Failed to load categories.", "danger");
    }
}

async function loadItems() {
    itemsBody.innerHTML = `<tr><td colspan="7" class="empty-state">
        <div class="spinner-border spinner-border-sm"></div>
        <div class="mt-2">Loading…</div>
    </td></tr>`;

    const params = new URLSearchParams();
    if (state.filters.q) params.set("q", state.filters.q);
    if (state.filters.category_id) params.set("category_id", state.filters.category_id);
    if (state.filters.status) params.set("status", state.filters.status);
    params.set("page", state.pagination.page);
    params.set("pageSize", state.pagination.pageSize);

    try {
        const data = await api.get("/items?" + params.toString());
        state.items = data.items;
        state.pagination = data.pagination;
        state.usage = data.usage;

        renderItemsTable();
        renderUsage();
        renderPagination();
    } catch (err) {
        itemsBody.innerHTML = `<tr><td colspan="7" class="empty-state text-danger">
            <i class="bi bi-exclamation-triangle"></i>
            ${escapeHtml(err.message || "Failed to load items.")}
        </td></tr>`;
    }
}

// ============================================================
// RENDER
// ============================================================
function renderUsage() {
    const { used, max, remaining } = state.usage;
    usageLine.textContent = `${used} of ${max} items used • ${remaining} remaining`;
    usageLine.className = `text-muted small ${remaining === 0 ? "text-danger" : ""}`;
}

function renderItemsTable() {
    if (state.items.length === 0) {
        itemsBody.innerHTML = `<tr><td colspan="7" class="empty-state">
            <i class="bi bi-box"></i>
            <div>No items yet</div>
            <div class="small">Click <strong>New Item</strong> or <strong>Import CSV</strong>.</div>
        </td></tr>`;
        return;
    }

    itemsBody.innerHTML = state.items.map((it, i) => {
        const num = (state.pagination.page - 1) * state.pagination.pageSize + i + 1;
        const statusBadge = it.status === "active"
            ? `<span class="badge badge-soft-success">Active</span>`
            : `<span class="badge badge-soft-muted">Inactive</span>`;

        return `
          <tr>
            <td>${num}</td>
            <td>
              <div class="fw-semibold">${escapeHtml(it.name)}</div>
              ${it.description ? `<div class="text-muted small text-truncate-2" style="max-width:340px;">${escapeHtml(it.description)}</div>` : ""}
            </td>
            <td class="d-none d-md-table-cell">${it.category_name ? escapeHtml(it.category_name) : '<span class="text-muted">—</span>'}</td>
            <td class="d-none d-lg-table-cell">${it.sku ? `<code>${escapeHtml(it.sku)}</code>` : '<span class="text-muted">—</span>'}</td>
            <td class="text-end fw-semibold">${money(it.default_price)}</td>
            <td>${statusBadge}</td>
            <td class="text-end">
              <div class="btn-group btn-group-sm">
                <button class="btn btn-outline-secondary" data-action="edit" data-id="${it.id}" title="Edit">
                  <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-outline-danger" data-action="delete" data-id="${it.id}" title="Delete">
                  <i class="bi bi-trash"></i>
                </button>
              </div>
            </td>
          </tr>`;
    }).join("");
}

function renderPagination() {
    const p = state.pagination;
    const from = p.total === 0 ? 0 : (p.page - 1) * p.pageSize + 1;
    const to = Math.min(p.page * p.pageSize, p.total);
    paginationInfo.textContent = `Showing ${from}–${to} of ${p.total}`;
    prevPageBtn.disabled = p.page <= 1;
    nextPageBtn.disabled = p.page >= p.totalPages;
}

function renderCategoryOptions() {
    const options = state.categories.map(c =>
        `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");

    filterCategory.innerHTML = `<option value="">All categories</option>` + options;

    const itCat = document.getElementById("itCategory");
    const current = itCat.value;
    itCat.innerHTML = `<option value="">— None —</option>` + options;
    itCat.value = current;
}

function renderCategoriesTable() {
    const body = document.getElementById("catBody");
    if (state.categories.length === 0) {
        body.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-3">No categories yet.</td></tr>`;
        return;
    }
    body.innerHTML = state.categories.map(c => `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td class="d-none d-md-table-cell">${c.description ? escapeHtml(c.description) : '<span class="text-muted">—</span>'}</td>
        <td class="text-end">${c.item_count}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-danger" data-cat-action="delete" data-id="${c.id}">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>`).join("");
}

// ============================================================
// ITEM MODAL
// ============================================================
document.getElementById("newItemBtn").addEventListener("click", () => {
    if (state.usage.remaining <= 0) {
        toast(`You've reached your limit of ${state.usage.max} items.`, "warning");
        return;
    }
    state.editingItem = null;
    document.getElementById("itemModalTitle").textContent = "New Item";
    document.getElementById("itemForm").reset();
    document.getElementById("itStatus").value = "active";
    clearAlert("itemAlert");
    itemModal.show();
});

itemsBody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = parseInt(btn.dataset.id, 10);
    const item = state.items.find(i => i.id === id);
    if (!item) return;

    if (action === "edit") {
        state.editingItem = item;
        document.getElementById("itemModalTitle").textContent = "Edit Item";
        document.getElementById("itName").value = item.name;
        document.getElementById("itDescription").value = item.description || "";
        document.getElementById("itPrice").value = item.default_price;
        document.getElementById("itSku").value = item.sku || "";
        document.getElementById("itCategory").value = item.category_id || "";
        document.getElementById("itStatus").value = item.status;
        clearAlert("itemAlert");
        itemModal.show();
    }

    if (action === "delete") {
        if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
        try {
            await api.del(`/items/${item.id}`);
            toast("Item deleted.");
            await loadItems();
        } catch (err) {
            toast(err.message || "Failed to delete.", "danger");
        }
    }
});

document.getElementById("itemForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAlert("itemAlert");

    const payload = {
        name: document.getElementById("itName").value.trim(),
        description: document.getElementById("itDescription").value.trim() || null,
        default_price: parseFloat(document.getElementById("itPrice").value),
        sku: document.getElementById("itSku").value.trim() || null,
        category_id: document.getElementById("itCategory").value || null,
        status: document.getElementById("itStatus").value,
    };

    if (!payload.name) return setAlert("itemAlert", "Name is required.");
    if (isNaN(payload.default_price) || payload.default_price < 0) return setAlert("itemAlert", "Price must be a positive number.");

    const btn = document.getElementById("itemSubmitBtn");
    const orig = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving…`;

    try {
        if (state.editingItem) {
            await api.put(`/items/${state.editingItem.id}`, payload);
            toast("Item updated.");
        } else {
            await api.post("/items", payload);
            toast("Item created.");
        }
        itemModal.hide();
        await loadItems();
    } catch (err) {
        setAlert("itemAlert", err.message || "Failed to save item.");
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
});

// ============================================================
// CATEGORIES MODAL
// ============================================================
document.getElementById("manageCategoriesBtn").addEventListener("click", () => {
    clearAlert("catAlert");
    document.getElementById("catName").value = "";
    document.getElementById("catDescription").value = "";
    categoriesModal.show();
});

document.getElementById("addCategoryBtn").addEventListener("click", async () => {
    clearAlert("catAlert");
    const name = document.getElementById("catName").value.trim();
    const description = document.getElementById("catDescription").value.trim();
    if (!name) return setAlert("catAlert", "Category name is required.");

    try {
        await api.post("/categories", { name, description });
        document.getElementById("catName").value = "";
        document.getElementById("catDescription").value = "";
        toast("Category added.");
        await loadCategories();
    } catch (err) {
        setAlert("catAlert", err.message || "Failed to add category.");
    }
});

document.getElementById("catBody").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-cat-action]");
    if (!btn) return;
    if (btn.dataset.catAction !== "delete") return;
    const id = parseInt(btn.dataset.id, 10);
    if (!confirm("Delete this category?")) return;
    try {
        await api.del(`/categories/${id}`);
        toast("Category deleted.");
        await loadCategories();
        await loadItems();
    } catch (err) {
        setAlert("catAlert", err.message || "Failed to delete category.");
    }
});

// ============================================================
// IMPORT
// ============================================================
const importFile      = document.getElementById("importFile");
const importPreviewWrap = document.getElementById("importPreviewWrap");
const validateBtn     = document.getElementById("validateBtn");
const commitImportBtn = document.getElementById("commitImportBtn");

document.getElementById("importBtn").addEventListener("click", () => {
    state.importFile = null;
    state.importValidated = null;
    importFile.value = "";
    importPreviewWrap.classList.add("d-none");
    validateBtn.classList.add("d-none");
    commitImportBtn.classList.add("d-none");
    clearAlert("importAlert");
    document.getElementById("importLimitWarning").classList.add("d-none");
    document.getElementById("importErrorList").classList.add("d-none");
    importModal.show();
});

importFile.addEventListener("change", () => {
    if (importFile.files.length === 0) return;
    state.importFile = importFile.files[0];
    state.importValidated = null;
    validateBtn.classList.remove("d-none");
    commitImportBtn.classList.add("d-none");
    importPreviewWrap.classList.add("d-none");
    clearAlert("importAlert");
});

validateBtn.addEventListener("click", async () => {
    if (!state.importFile) return;
    clearAlert("importAlert");

    const fd = new FormData();
    fd.append("file", state.importFile);

    validateBtn.disabled = true;
    validateBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Validating…`;

    try {
        const res = await fetch("/items/import/validate", {
            method: "POST",
            credentials: "include",
            body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw data;

        state.importValidated = data;
        renderImportPreview(data);
        importPreviewWrap.classList.remove("d-none");
        commitImportBtn.classList.remove("d-none");
        if (data.validRows === 0) commitImportBtn.disabled = true;
        else commitImportBtn.disabled = false;
    } catch (err) {
        setAlert("importAlert", err.message || "Validation failed.");
    } finally {
        validateBtn.disabled = false;
        validateBtn.innerHTML = `<i class="bi bi-search me-1"></i> Validate`;
    }
});

function renderImportPreview(data) {
    document.getElementById("impTotal").textContent = data.totalRows;
    document.getElementById("impValid").textContent = data.validRows;
    document.getElementById("impErrors").textContent = data.errorRows;
    document.getElementById("impRemaining").textContent = data.usage.remaining;

    const warning = document.getElementById("importLimitWarning");
    if (data.usage.limitExceeded) {
        warning.className = "alert alert-warning";
        warning.textContent =
            `This import would bring your total to ${data.usage.projected}, ` +
            `but your limit is ${data.usage.max}. Reduce the file or ask support to raise your limit.`;
        warning.classList.remove("d-none");
        commitImportBtn.disabled = true;
    } else {
        warning.classList.add("d-none");
        commitImportBtn.disabled = false;
    }

    const errList = document.getElementById("importErrorList");
    const errBody = document.getElementById("impErrorsBody");
    if (data.errors.length === 0) {
        errList.classList.add("d-none");
    } else {
        errList.classList.remove("d-none");
        errBody.innerHTML = data.errors.map(e => `
          <tr><td>${e.line}</td><td>${escapeHtml(e.field)}</td><td>${escapeHtml(e.message)}</td></tr>
        `).join("");
    }
}

commitImportBtn.addEventListener("click", async () => {
    if (!state.importFile) return;
    if (!confirm("Import the valid rows now?")) return;
    clearAlert("importAlert");

    const fd = new FormData();
    fd.append("file", state.importFile);

    commitImportBtn.disabled = true;
    const orig = commitImportBtn.innerHTML;
    commitImportBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Importing…`;

    try {
        const res = await fetch("/items/import/commit", {
            method: "POST",
            credentials: "include",
            body: fd,
        });
        const data = await res.json();
        if (!res.ok) throw data;

        importModal.hide();
        toast(`${data.success} item(s) imported. ${data.failed} skipped.`);
        await loadItems();
    } catch (err) {
        setAlert("importAlert", err.message || "Import failed.");
    } finally {
        commitImportBtn.disabled = false;
        commitImportBtn.innerHTML = orig;
    }
});

// ============================================================
// FILTERS / PAGINATION
// ============================================================
let searchTimer;
searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        state.filters.q = searchInput.value;
        state.pagination.page = 1;
        loadItems();
    }, 300);
});

filterCategory.addEventListener("change", () => {
    state.filters.category_id = filterCategory.value;
    state.pagination.page = 1;
    loadItems();
});

filterStatus.addEventListener("change", () => {
    state.filters.status = filterStatus.value;
    state.pagination.page = 1;
    loadItems();
});

clearFiltersBtn.addEventListener("click", () => {
    searchInput.value = "";
    filterCategory.value = "";
    filterStatus.value = "";
    state.filters = { q: "", category_id: "", status: "" };
    state.pagination.page = 1;
    loadItems();
});

prevPageBtn.addEventListener("click", () => {
    if (state.pagination.page > 1) {
        state.pagination.page--;
        loadItems();
    }
});

nextPageBtn.addEventListener("click", () => {
    if (state.pagination.page < state.pagination.totalPages) {
        state.pagination.page++;
        loadItems();
    }
});

// ============================================================
// BOOT
// ============================================================
(async function boot() {
    await loadCategories();
    await loadItems();
})();