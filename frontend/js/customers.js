// ============================================================
// js/customers.js — People the company issues receipts to
// ============================================================
// Students, tenants, patients, members. Records added here are what the
// receipt form searches, so a name can be picked instead of retyped.
// ============================================================

// ---------- State ----------
let people = [];
let page = 1;
let totalPages = 1;
let editingId = null;
let deleteTarget = null;
let validatedFile = null;

// ---------- Element refs ----------
const peopleBody = document.getElementById("peopleBody");
const navUser = document.getElementById("navUser");
const toastContainer = document.getElementById("toastContainer");

const personModal = new bootstrap.Modal("#personModal");
const importModal = new bootstrap.Modal("#importModal");
const deleteModal = new bootstrap.Modal("#deleteModal");

// ---------- Helpers ----------
function toast(message, type = "success") {
    const el = document.createElement("div");
    el.className = `toast align-items-center text-bg-${type} border-0`;
    el.role = "alert";
    el.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">${escapeHtml(message)}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>`;
    toastContainer.appendChild(el);
    new bootstrap.Toast(el, { delay: 4000 }).show();
    el.addEventListener("hidden.bs.toast", () => el.remove());
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}

function setAlert(id, message, type = "danger") {
    const el = document.getElementById(id);
    el.className = `alert alert-${type}`;
    el.textContent = message;
    el.classList.remove("d-none");
}
function clearAlert(id) {
    document.getElementById(id).classList.add("d-none");
}

function humanise(key) {
    return String(key).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

const TYPE_STYLES = {
    student: "bg-primary-subtle text-primary-emphasis",
    customer: "bg-secondary-subtle text-secondary-emphasis",
    tenant: "bg-info-subtle text-info-emphasis",
    participant: "bg-success-subtle text-success-emphasis",
    patient: "bg-danger-subtle text-danger-emphasis",
    member: "bg-warning-subtle text-warning-emphasis",
    subscriber: "bg-info-subtle text-info-emphasis",
    donor: "bg-success-subtle text-success-emphasis",
    guest: "bg-secondary-subtle text-secondary-emphasis",
};

function typeBadge(type) {
    const style = TYPE_STYLES[type] || TYPE_STYLES.customer;
    return `<span class="badge ${style}">${escapeHtml(humanise(type || "customer"))}</span>`;
}

// ---------- Auth ----------
let currentUser = null;
(async function guard() {
    try {
        const { user } = await api.get("/auth/me");
        currentUser = user;
        if (currentUser.role === "super_admin") {
            window.location.href = "/superadmin-dashboard.html";
            return;
        }
        // §7.3/§7.4: the address book is maintained by owners and administrators.
        // Staff still reach a person by searching while they issue a receipt.
        if (currentUser.role !== "owner" && currentUser.role !== "admin") {
            window.location.href = "/dashboard.html";
            return;
        }
        navUser.textContent = currentUser.full_name || "";
        await load();
    } catch {
        window.location.href = "/index.html";
    }
})();

document.getElementById("logoutBtn").addEventListener("click", async () => {
    try { await api.post("/auth/logout"); } catch {}
    window.location.href = "/index.html";
});

// ---------- Load ----------
async function load() {
    peopleBody.innerHTML = `
      <tr><td colspan="8" class="empty-state">
        <div class="spinner-border spinner-border-sm"></div>
        <div class="mt-2">Loading…</div>
      </td></tr>`;

    const params = new URLSearchParams({ page, pageSize: 25 });
    const q = document.getElementById("searchInput").value.trim();
    const type = document.getElementById("filterType").value;
    const status = document.getElementById("filterStatus").value;
    if (q) params.set("q", q);
    if (type) params.set("type", type);
    if (status) params.set("status", status);

    try {
        const data = await api.get("/customers?" + params.toString());
        people = data.customers || [];
        totalPages = data.pagination?.totalPages || 1;
        render();
    } catch (err) {
        peopleBody.innerHTML = `
          <tr><td colspan="8" class="empty-state text-danger">
            <i class="bi bi-exclamation-triangle"></i>
            ${escapeHtml(err.message || "Failed to load people.")}
          </td></tr>`;
    }
}

function render() {
    if (people.length === 0) {
        peopleBody.innerHTML = `
          <tr><td colspan="8" class="empty-state">
            <i class="bi bi-people"></i>
            <div>No people yet</div>
            <div class="small">
              Add one, or <strong>Import CSV</strong> to upload a class or client list in one go.
            </div>
          </td></tr>`;
        document.getElementById("paginationInfo").textContent = "0 people";
        document.getElementById("prevPageBtn").disabled = true;
        document.getElementById("nextPageBtn").disabled = true;
        return;
    }

    peopleBody.innerHTML = people.map((p, i) => {
        const details = Object.entries(p.profiles || {})
            .map(([key, value]) => `${escapeHtml(humanise(key))}: <strong>${escapeHtml(value)}</strong>`)
            .join("<br>");

        const contact = [p.phone, p.email].filter(Boolean).map(escapeHtml).join("<br>");

        return `
          <tr>
            <td>${(page - 1) * 25 + i + 1}</td>
            <td class="fw-semibold">${escapeHtml(p.full_name)}</td>
            <td class="d-none d-md-table-cell">${typeBadge(p.customer_type)}</td>
            <td class="d-none d-md-table-cell">
              ${p.external_ref ? `<code>${escapeHtml(p.external_ref)}</code>` : '<span class="text-muted">—</span>'}
            </td>
            <td class="d-none d-lg-table-cell small">${details || '<span class="text-muted">—</span>'}</td>
            <td class="d-none d-lg-table-cell small">${contact || '<span class="text-muted">—</span>'}</td>
            <td>
              ${p.is_active
                  ? '<span class="badge bg-success-subtle text-success-emphasis">Active</span>'
                  : '<span class="badge bg-secondary-subtle text-secondary-emphasis">Inactive</span>'}
            </td>
            <td class="text-end">
              <div class="btn-group btn-group-sm">
                <button class="btn btn-outline-secondary" data-action="edit" data-id="${p.id}" title="Edit">
                  <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-outline-danger" data-action="delete" data-id="${p.id}" title="Remove">
                  <i class="bi bi-trash"></i>
                </button>
              </div>
            </td>
          </tr>`;
    }).join("");

    const from = (page - 1) * 25 + 1;
    document.getElementById("paginationInfo").textContent =
        `Showing ${from}–${from + people.length - 1} · page ${page} of ${totalPages}`;
    document.getElementById("prevPageBtn").disabled = page <= 1;
    document.getElementById("nextPageBtn").disabled = page >= totalPages;
}

// ---------- Filters ----------
let searchTimer = null;
document.getElementById("searchInput").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { page = 1; load(); }, 300);
});
document.getElementById("filterType").addEventListener("change", () => { page = 1; load(); });
document.getElementById("filterStatus").addEventListener("change", () => { page = 1; load(); });
document.getElementById("clearFiltersBtn").addEventListener("click", () => {
    document.getElementById("searchInput").value = "";
    document.getElementById("filterType").value = "";
    document.getElementById("filterStatus").value = "";
    page = 1;
    load();
});
document.getElementById("prevPageBtn").addEventListener("click", () => { if (page > 1) { page -= 1; load(); } });
document.getElementById("nextPageBtn").addEventListener("click", () => { if (page < totalPages) { page += 1; load(); } });

// ---------- Remembered details (attributes) ----------
function addAttrRow(key = "", value = "") {
    const row = document.createElement("div");
    row.className = "row g-2 align-items-center mb-2 attr-row";
    row.innerHTML = `
      <div class="col-5">
        <input type="text" class="form-control form-control-sm attr-key" list="attrSuggestions"
               placeholder="class" value="${escapeHtml(key)}">
      </div>
      <div class="col-6">
        <input type="text" class="form-control form-control-sm attr-value"
               placeholder="JSS 1" value="${escapeHtml(value)}">
      </div>
      <div class="col-1 text-end">
        <button type="button" class="btn btn-sm btn-outline-danger attr-remove" title="Remove">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>`;
    row.querySelector(".attr-remove").addEventListener("click", () => row.remove());
    document.getElementById("attrRows").appendChild(row);
}

document.getElementById("addAttrBtn").addEventListener("click", () => addAttrRow());

function collectAttributes() {
    const profiles = {};
    document.querySelectorAll("#attrRows .attr-row").forEach(row => {
        const key = row.querySelector(".attr-key").value.trim().toLowerCase()
            .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        const value = row.querySelector(".attr-value").value.trim();
        if (key && value) profiles[key] = value;
    });
    return profiles;
}

// ---------- Person modal ----------
function openPersonModal(person) {
    clearAlert("personAlert");
    document.getElementById("personForm").reset();
    document.getElementById("attrRows").innerHTML = "";
    editingId = person ? person.id : null;

    document.getElementById("personModalTitle").textContent = person ? "Edit Person" : "Add Person";
    document.getElementById("pName").value = person?.full_name || "";
    document.getElementById("pType").value = person?.customer_type || "student";
    document.getElementById("pRef").value = person?.external_ref || "";
    document.getElementById("pPhone").value = person?.phone || "";
    document.getElementById("pEmail").value = person?.email || "";
    document.getElementById("pAddress").value = person?.address || "";
    document.getElementById("pActive").checked = person ? person.is_active !== false : true;

    const profiles = person?.profiles || {};
    Object.entries(profiles).forEach(([key, value]) => addAttrRow(key, value));
    if (Object.keys(profiles).length === 0) addAttrRow();

    personModal.show();
}

document.getElementById("newPersonBtn").addEventListener("click", () => openPersonModal(null));

peopleBody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const id = parseInt(btn.dataset.id, 10);
    const person = people.find(p => p.id === id);
    if (!person) return;

    if (btn.dataset.action === "edit") {
        // Load the full record so attributes are current.
        try {
            const data = await api.get(`/customers/${id}`);
            openPersonModal(data.customer);
        } catch (err) {
            toast(err.message || "Failed to load that person.", "danger");
        }
    }

    if (btn.dataset.action === "delete") {
        deleteTarget = person;
        clearAlert("deleteAlert");
        document.getElementById("delName").textContent = person.full_name;
        deleteModal.show();
    }
});

document.getElementById("personForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAlert("personAlert");

    const payload = {
        full_name: document.getElementById("pName").value.trim(),
        customer_type: document.getElementById("pType").value,
        external_ref: document.getElementById("pRef").value.trim(),
        phone: document.getElementById("pPhone").value.trim(),
        email: document.getElementById("pEmail").value.trim(),
        address: document.getElementById("pAddress").value.trim(),
        is_active: document.getElementById("pActive").checked,
        profiles: collectAttributes(),
    };

    if (!payload.full_name) {
        setAlert("personAlert", "A name is required.");
        return;
    }

    const btn = document.getElementById("personSubmitBtn");
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving…`;

    try {
        if (editingId) {
            await api.put(`/customers/${editingId}`, payload);
        } else {
            await api.post("/customers", payload);
        }
        personModal.hide();
        toast(editingId ? "Person updated." : "Person added.", "success");
        await load();
    } catch (err) {
        setAlert("personAlert", err.message || "Could not save this person.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
    }
});

// ---------- Delete ----------
document.getElementById("confirmDeleteBtn").addEventListener("click", async () => {
    if (!deleteTarget) return;
    clearAlert("deleteAlert");

    const btn = document.getElementById("confirmDeleteBtn");
    btn.disabled = true;

    try {
        await api.del(`/customers/${deleteTarget.id}`);
        deleteModal.hide();
        toast("Person removed.", "success");
        await load();
    } catch (err) {
        setAlert("deleteAlert", err.message || "Could not remove this person.");
    } finally {
        btn.disabled = false;
    }
});

// ---------- CSV import ----------
document.getElementById("importBtn").addEventListener("click", () => {
    clearAlert("importAlert");
    document.getElementById("importFile").value = "";
    document.getElementById("importPreviewWrap").classList.add("d-none");
    document.getElementById("commitImportBtn").classList.add("d-none");
    document.getElementById("recheckImportBtn").classList.add("d-none");
    validatedFile = null;
    importModal.show();
});

function renderImportPreview(data) {
    document.getElementById("impTotal").textContent = data.totalRows;
    document.getElementById("impValid").textContent = data.validRows;
    document.getElementById("impErrors").textContent = data.errorRows;

    const errorWrap = document.getElementById("importErrorList");
    if (data.errorRows > 0) {
        document.getElementById("impErrorsBody").innerHTML = (data.errors || []).map(err => `
          <tr>
            <td>${err.line}</td>
            <td><code>${escapeHtml(err.field || "-")}</code></td>
            <td>${escapeHtml(err.message)}</td>
          </tr>`).join("");
        errorWrap.classList.remove("d-none");
    } else {
        errorWrap.classList.add("d-none");
    }

    const previewWrap = document.getElementById("importPreviewTable");
    if ((data.preview || []).length) {
        document.getElementById("impPreviewBody").innerHTML = data.preview.map(row => `
          <tr>
            <td>${escapeHtml(row.full_name)}</td>
            <td>${escapeHtml(humanise(row.customer_type))}</td>
            <td>${row.external_ref ? `<code>${escapeHtml(row.external_ref)}</code>` : "—"}</td>
            <td class="small">${
                Object.entries(row.profiles || {})
                    .map(([k, v]) => `${escapeHtml(humanise(k))}: ${escapeHtml(v)}`)
                    .join(", ") || "—"
            }</td>
          </tr>`).join("");
        previewWrap.classList.remove("d-none");
    } else {
        previewWrap.classList.add("d-none");
    }

    document.getElementById("importPreviewWrap").classList.remove("d-none");
    document.getElementById("recheckImportBtn").classList.remove("d-none");
    document.getElementById("commitImportBtn").classList.toggle("d-none", data.validRows === 0);
}

async function checkFile(file) {
    const formData = new FormData();
    formData.append("file", file);
    const data = await api.post("/customers/import/validate", formData);
    validatedFile = file;
    renderImportPreview(data);
}

document.getElementById("importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    clearAlert("importAlert");
    try {
        await checkFile(file);
    } catch (err) {
        setAlert("importAlert", err.message || "Could not read that file.");
    }
});

document.getElementById("recheckImportBtn").addEventListener("click", async () => {
    const file = document.getElementById("importFile").files[0];
    if (!file) return;
    clearAlert("importAlert");
    try {
        await checkFile(file);
        toast("File re-checked.", "success");
    } catch (err) {
        setAlert("importAlert", err.message || "Could not read that file.");
    }
});

document.getElementById("commitImportBtn").addEventListener("click", async () => {
    const file = document.getElementById("importFile").files[0];
    if (!file) return;
    clearAlert("importAlert");

    const btn = document.getElementById("commitImportBtn");
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Importing…`;

    try {
        const formData = new FormData();
        formData.append("file", file);
        const result = await api.post("/customers/import/commit", formData);

        importModal.hide();
        const skipped = result.skipped ? ` ${result.skipped} row(s) were skipped.` : "";
        toast(`${result.message}${skipped}`, "success");
        page = 1;
        await load();
    } catch (err) {
        setAlert("importAlert", err.message || "Nothing was imported. Please try again.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
    }
});
