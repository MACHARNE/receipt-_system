// ============================================================
// js/templates.js — Templates list + builder
// ============================================================

let templates = [];
let enabledTypes = [];
let itemsCatalog = [];
let currentUser = null;
let editingTemplateId = null;

// Modal refs
const templateModal = new bootstrap.Modal("#templateModal");
const navUser = document.getElementById("navUser");
const pageAlert = document.getElementById("pageAlert");
const toastContainer = document.getElementById("toastContainer");

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
function showPageAlert(msg, type = "danger") {
    pageAlert.className = `alert alert-${type}`;
    pageAlert.textContent = msg;
    pageAlert.classList.remove("d-none");
}
function hidePageAlert() { pageAlert.classList.add("d-none"); }
function setAlert(id, msg, type = "danger") {
    const el = document.getElementById(id);
    el.className = `alert alert-${type}`;
    el.textContent = msg;
    el.classList.remove("d-none");
}
function clearAlert(id) { document.getElementById(id).classList.add("d-none"); }
function money(n) { return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 }); }

// ---------- AUTH ----------
(async function guard() {
    try {
        const { user } = await api.get("/auth/me");
        currentUser = user;
        if (currentUser.role === "super_admin") {
            window.location.href = "/superadmin-dashboard.html";
            return;
        }
        navUser.textContent = currentUser.full_name || "";
    } catch {
        window.location.href = "/index.html";
    }
})();

document.getElementById("logoutBtn").addEventListener("click", async () => {
    try { await api.post("/auth/logout"); } catch {}
    window.location.href = "/index.html";
});

// ---------- LOAD DATA ----------
async function loadAll() {
    try {
        const [typesRes, templatesRes] = await Promise.all([
            api.get("/receipt-config/types"),
            api.get("/receipt-config/templates"),
        ]);
        enabledTypes = (typesRes.types || []).filter(t => t.is_enabled);
        templates = templatesRes.templates || [];

        // Load full item catalog (max 500 for a small dropdown — fine for v1)
        try {
            const itemsRes = await api.get("/items?pageSize=100");
            itemsCatalog = itemsRes.items || [];
        } catch {
            itemsCatalog = [];
        }

        renderTemplates();
        populateTypeSelect();
    } catch (err) {
        showPageAlert(err.message || "Failed to load data.");
    }
}

function populateTypeSelect() {
    const sel = document.getElementById("tType");
    sel.innerHTML = `<option value="">Select an enabled type…</option>` +
        enabledTypes.map(t =>
            `<option value="${t.id}">${escapeHtml(t.name)}</option>`
        ).join("");
}

// ---------- RENDER LIST ----------
function renderTemplates() {
    const body = document.getElementById("templatesBody");

    if (templates.length === 0) {
        body.innerHTML = `<tr><td colspan="6" class="empty-state">
            <i class="bi bi-file-earmark-text"></i>
            <div>No templates yet</div>
            <div class="small">Click <strong>New Template</strong> to create one.</div>
        </td></tr>`;
        return;
    }

    body.innerHTML = templates.map((t, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>
          <div class="fw-semibold">${escapeHtml(t.name)}</div>
          ${t.description ? `<div class="text-muted small">${escapeHtml(t.description)}</div>` : ""}
        </td>
        <td class="d-none d-md-table-cell">${escapeHtml(t.type_name)}</td>
        <td class="d-none d-lg-table-cell">${t.default_item_count}</td>
        <td>${t.is_active
            ? '<span class="badge badge-soft-success">Active</span>'
            : '<span class="badge badge-soft-muted">Inactive</span>'}</td>
        <td class="text-end">
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-secondary" data-action="edit" data-id="${t.id}">
              <i class="bi bi-pencil"></i>
            </button>
            <button class="btn btn-outline-danger" data-action="delete" data-id="${t.id}">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </td>
      </tr>`).join("");
}

// ---------- ACTION HANDLERS ----------
document.getElementById("templatesBody").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = parseInt(btn.dataset.id, 10);

    if (btn.dataset.action === "edit") {
        await openEditor(id);
    }

    if (btn.dataset.action === "delete") {
        if (!confirm("Delete this template?")) return;
        try {
            await api.del(`/receipt-config/templates/${id}`);
            toast("Template deleted.");
            await loadAll();
        } catch (err) {
            toast(err.message || "Failed to delete.", "danger");
        }
    }
});

document.getElementById("newTemplateBtn").addEventListener("click", () => {
    if (enabledTypes.length === 0) {
        toast("Enable a receipt type first.", "warning");
        window.location.href = "/receipt-types.html";
        return;
    }
    editingTemplateId = null;
    document.getElementById("templateModalTitle").textContent = "New Template";
    document.getElementById("templateForm").reset();
    document.getElementById("tFieldDefaults").innerHTML =
        `<div class="text-muted small">Select a receipt type to load fields.</div>`;
    renderDefaultItems([]);
    clearAlert("templateAlert");
    templateModal.show();
});

// ---------- EDITOR ----------
async function openEditor(id) {
    editingTemplateId = id;
    document.getElementById("templateModalTitle").textContent = "Edit Template";

    try {
        const { template } = await api.get(`/receipt-config/templates/${id}`);

        document.getElementById("tName").value = template.name;
        document.getElementById("tType").value = template.receipt_type_id;
        document.getElementById("tDescription").value = template.description || "";
        document.getElementById("tFooter").value = template.default_footer || "";
        document.getElementById("tNotes").value = template.default_notes || "";

        // Load field defaults for this type
        await loadFieldDefaultsFor(template.receipt_type_id, template.default_field_values || {});

        // Load default items
        renderDefaultItems(template.default_items || []);

        clearAlert("templateAlert");
        templateModal.show();
    } catch (err) {
        toast(err.message || "Failed to load template.", "danger");
    }
}

document.getElementById("tType").addEventListener("change", async (e) => {
    const typeId = e.target.value;
    if (!typeId) {
        document.getElementById("tFieldDefaults").innerHTML =
            `<div class="text-muted small">Select a receipt type to load fields.</div>`;
        return;
    }
    await loadFieldDefaultsFor(typeId, {});
});

async function loadFieldDefaultsFor(typeId, existingValues) {
    try {
        const data = await api.get(`/receipt-config/types/${typeId}/fields`);
        const allFields = [...data.master_fields, ...data.custom_fields];

        const wrap = document.getElementById("tFieldDefaults");
        if (allFields.length === 0) {
            wrap.innerHTML = `<div class="text-muted small">This type has no fields.</div>`;
            return;
        }

        wrap.innerHTML = `<div class="row g-3">` + allFields.map(f => {
            const val = existingValues[f.field_key] ?? f.default_value ?? "";
            const badge = f.origin === "master"
                ? `<span class="badge badge-soft-muted ms-1">master</span>`
                : `<span class="badge badge-soft-info ms-1">custom</span>`;
            return `
              <div class="col-md-6">
                <label class="form-label small">${escapeHtml(f.field_label)} ${badge}</label>
                ${renderDefaultInput(f, val)}
              </div>`;
        }).join("") + `</div>`;
    } catch (err) {
        document.getElementById("tFieldDefaults").innerHTML =
            `<div class="text-danger small">${escapeHtml(err.message)}</div>`;
    }
}

function renderDefaultInput(f, value) {
    const key = `data-field-key="${escapeHtml(f.field_key)}"`;
    switch (f.field_type) {
        case "select": {
            const opts = Array.isArray(f.options)
                ? f.options
                : (f.options?.options || []);
            return `<select class="form-select form-select-sm" ${key}>
                <option value="">—</option>
                ${opts.map(o => `<option value="${escapeHtml(o)}" ${String(value) === String(o) ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
            </select>`;
        }
        case "textarea":
            return `<textarea class="form-control form-control-sm" rows="2" ${key}>${escapeHtml(value)}</textarea>`;
        case "date":
            return `<input type="date" class="form-control form-control-sm" ${key} value="${escapeHtml(value)}">`;
        case "number":
        case "currency":
            return `<input type="number" step="0.01" class="form-control form-control-sm" ${key} value="${escapeHtml(value)}">`;
        case "checkbox":
            return `<div class="form-check"><input class="form-check-input" type="checkbox" ${key} ${value ? "checked" : ""}></div>`;
        default:
            return `<input type="text" class="form-control form-control-sm" ${key} value="${escapeHtml(value)}">`;
    }
}

function collectFieldDefaults() {
    const out = {};
    document.querySelectorAll("#tFieldDefaults [data-field-key]").forEach(el => {
        const key = el.dataset.fieldKey;
        if (el.type === "checkbox") out[key] = el.checked;
        else out[key] = el.value;
    });
    return out;
}

// ---------- DEFAULT ITEMS ----------
function renderDefaultItems(items) {
    const body = document.getElementById("tItemsBody");
    if (!items || items.length === 0) {
        body.innerHTML = `<tr><td colspan="5" class="text-muted small text-center py-3">No default items yet</td></tr>`;
        return;
    }

    body.innerHTML = items.map((it, i) => `
      <tr data-item-row data-index="${i}">
        <td>
          <input type="text" class="form-control form-control-sm" data-item-name
                 value="${escapeHtml(it.item_name || "")}">
          <input type="hidden" data-item-id value="${it.item_id || ""}">
        </td>
        <td><input type="number" min="0" step="0.01" class="form-control form-control-sm"
                   data-item-qty value="${it.quantity || 1}"></td>
        <td><input type="number" min="0" step="0.01" class="form-control form-control-sm"
                   data-item-price value="${it.unit_price || 0}"></td>
        <td class="text-end fw-semibold" data-item-total>${money((it.quantity || 1) * (it.unit_price || 0))}</td>
        <td><button type="button" class="btn btn-sm btn-outline-danger" data-item-remove>
          <i class="bi bi-x"></i></button></td>
      </tr>`).join("");
}

document.getElementById("addDefaultItemBtn").addEventListener("click", () => {
    const items = collectDefaultItems();
    items.push({ item_id: null, item_name: "", quantity: 1, unit_price: 0 });
    renderDefaultItems(items);
});

document.getElementById("tItemsBody").addEventListener("input", (e) => {
    const row = e.target.closest("[data-item-row]");
    if (!row) return;
    const qty = parseFloat(row.querySelector("[data-item-qty]").value) || 0;
    const price = parseFloat(row.querySelector("[data-item-price]").value) || 0;
    row.querySelector("[data-item-total]").textContent = money(qty * price);
});

document.getElementById("tItemsBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-item-remove]");
    if (!btn) return;
    const row = btn.closest("[data-item-row]");
    const idx = parseInt(row.dataset.index, 10);
    const items = collectDefaultItems();
    items.splice(idx, 1);
    renderDefaultItems(items);
});

function collectDefaultItems() {
    const out = [];
    document.querySelectorAll("#tItemsBody [data-item-row]").forEach(row => {
        const name = row.querySelector("[data-item-name]").value.trim();
        if (!name) return;
        out.push({
            item_id: row.querySelector("[data-item-id]").value || null,
            item_name: name,
            quantity: parseFloat(row.querySelector("[data-item-qty]").value) || 1,
            unit_price: parseFloat(row.querySelector("[data-item-price]").value) || 0,
        });
    });
    return out;
}

// ---------- SAVE ----------
document.getElementById("templateForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAlert("templateAlert");

    const name = document.getElementById("tName").value.trim();
    const typeId = document.getElementById("tType").value;
    if (!name) return setAlert("templateAlert", "Name is required.");
    if (!typeId) return setAlert("templateAlert", "Receipt type is required.");

    const payload = {
        name,
        receipt_type_id: parseInt(typeId, 10),
        description: document.getElementById("tDescription").value.trim() || null,
        default_footer: document.getElementById("tFooter").value.trim() || null,
        default_notes: document.getElementById("tNotes").value.trim() || null,
        default_field_values: collectFieldDefaults(),
        default_items: collectDefaultItems(),
    };

    const btn = document.getElementById("tSubmitBtn");
    btn.disabled = true;
    const orig = btn.textContent;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving…`;

    try {
        if (editingTemplateId) {
            await api.put(`/receipt-config/templates/${editingTemplateId}`, payload);
            toast("Template updated.");
        } else {
            await api.post("/receipt-config/templates", payload);
            toast("Template created.");
        }
        templateModal.hide();
        await loadAll();
    } catch (err) {
        setAlert("templateAlert", err.message || "Failed to save template.");
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
});

// ---------- BOOT ----------
loadAll();