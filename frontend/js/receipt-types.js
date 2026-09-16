// ============================================================
// js/receipt-types.js — Types + custom fields + appearance + templates
// ============================================================

// ---------- State ----------
let types = [];
let currentType = null;                 // type being configured
let currentFields = { master: [], custom: [] };
let editingFieldId = null;

// ---------- Refs ----------
const navUser        = document.getElementById("navUser");
const pageAlert      = document.getElementById("pageAlert");
const enabledList    = document.getElementById("enabledList");
const availableList  = document.getElementById("availableList");
const enabledCount   = document.getElementById("enabledCount");
const availableCount = document.getElementById("availableCount");
const toastContainer = document.getElementById("toastContainer");

const configModal = new bootstrap.Modal("#configModal");
const fieldModal  = new bootstrap.Modal("#fieldModal");

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

// ============================================================
// AUTH
// ============================================================
let currentUser = null;
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
// LOAD TYPES
// ============================================================
async function loadTypes() {
    try {
        const data = await api.get("/receipt-config/types");
        types = data.types || [];
        render();
    } catch (err) {
        showPageAlert(err.message || "Failed to load receipt types.");
    }
}

// ============================================================
// RENDER LISTS
// ============================================================
function render() {
    const enabled = types.filter(t => t.is_enabled);
    const available = types.filter(t => !t.is_enabled);

    enabledCount.textContent = enabled.length;
    availableCount.textContent = available.length;

    enabledList.innerHTML = enabled.length
        ? enabled.map(t => typeRow(t, true)).join("")
        : `<div class="empty-state"><i class="bi bi-inbox"></i>
           <div>No types enabled yet</div>
           <div class="small">Enable one from the right panel.</div></div>`;

    availableList.innerHTML = available.length
        ? available.map(t => typeRow(t, false)).join("")
        : `<div class="empty-state"><i class="bi bi-check2-all"></i>
           <div>All types enabled</div></div>`;
}

function typeRow(t, isEnabled) {
    const icon = t.icon || "bi-receipt";
    const colorDot = t.theme_base_color
        ? `<span class="ms-2" style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${escapeHtml(t.theme_base_color)};" title="Color set"></span>`
        : "";
    return `
      <div class="d-flex align-items-start gap-3 p-3 border-bottom">
        <div class="rounded-circle bg-light d-flex align-items-center justify-content-center"
             style="width:44px;height:44px;flex-shrink:0;">
          <i class="bi ${escapeHtml(icon)} text-primary"></i>
        </div>
        <div class="flex-grow-1 min-w-0">
          <div class="fw-semibold">${escapeHtml(t.name)}${colorDot}</div>
          ${t.description ? `<div class="text-muted small">${escapeHtml(t.description)}</div>` : ""}
          <div class="text-muted small mt-1">
            ${t.master_field_count} master · ${t.custom_field_count} custom · ${t.template_count} template(s)
          </div>
          ${isEnabled
            ? `<button class="btn btn-link btn-sm p-0 mt-1" data-action="configure" data-id="${t.id}">
                 <i class="bi bi-sliders me-1"></i><span class="small">Configure</span>
               </button>`
            : ""}
        </div>
        <div>
          ${isEnabled
            ? `<button class="btn btn-sm btn-outline-danger" data-action="disable" data-id="${t.id}">
                 <i class="bi bi-x-circle me-1"></i> Disable
               </button>`
            : `<button class="btn btn-sm btn-primary" data-action="enable" data-id="${t.id}">
                 <i class="bi bi-plus-circle me-1"></i> Enable
               </button>`}
        </div>
      </div>`;
}

// ============================================================
// ACTION DELEGATION
// ============================================================
document.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;
    const id = parseInt(btn.dataset.id, 10);
    const type = types.find(t => t.id === id);
    if (!type) return;

    if (action === "enable") {
        try {
            btn.disabled = true;
            await api.put(`/receipt-config/types/${id}/enable`, {});
            toast(`"${type.name}" enabled.`);
            await loadTypes();
        } catch (err) {
            toast(err.message || "Failed to enable.", "danger");
            btn.disabled = false;
        }
    }

    if (action === "disable") {
        if (!confirm(`Disable "${type.name}"?`)) return;
        try {
            btn.disabled = true;
            await api.put(`/receipt-config/types/${id}/disable`, {});
            toast(`"${type.name}" disabled.`);
            await loadTypes();
        } catch (err) {
            toast(err.message || "Failed to disable.", "danger");
            btn.disabled = false;
        }
    }

    if (action === "configure") {
        await openConfig(type);
    }
});

// ============================================================
// CONFIG MODAL
// ============================================================
async function openConfig(type) {
    currentType = type;
    document.getElementById("configModalTitle").textContent = `Configure — ${type.name}`;

    // Reset to Fields tab
    const firstTab = document.querySelector('#configTabs button[data-bs-target="#tabFields"]');
    new bootstrap.Tab(firstTab).show();

    configModal.show();

    await Promise.all([
        loadFields(type.id),
        loadTheme(type.id),
        loadTemplates(type.id),
    ]);
}

// ---------- FIELDS ----------
async function loadFields(typeId) {
    document.getElementById("masterFieldsList").innerHTML =
        `<div class="p-3 text-muted small">Loading…</div>`;
    document.getElementById("customFieldsList").innerHTML =
        `<div class="p-3 text-muted small">Loading…</div>`;

    try {
        const data = await api.get(`/receipt-config/types/${typeId}/fields`);
        currentFields = { master: data.master_fields, custom: data.custom_fields };
        renderFields();
    } catch (err) {
        toast(err.message || "Failed to load fields.", "danger");
    }
}

function renderFields() {
    const masterEl = document.getElementById("masterFieldsList");
    const customEl = document.getElementById("customFieldsList");

    masterEl.innerHTML = currentFields.master.length
        ? currentFields.master.map(f => fieldRow(f, false)).join("")
        : `<div class="p-3 text-muted small">No master fields.</div>`;

    customEl.innerHTML = currentFields.custom.length
        ? currentFields.custom.map(f => fieldRow(f, true)).join("")
        : `<div class="p-3 text-muted small">No custom fields yet.</div>`;
}

function fieldRow(f, isCustom) {
    const req = f.is_required ? `<span class="badge badge-soft-warning ms-1">Required</span>` : "";
    const actions = isCustom
        ? `<div class="btn-group btn-group-sm">
             <button class="btn btn-outline-secondary" data-field-action="edit" data-field-id="${f.id}">
               <i class="bi bi-pencil"></i>
             </button>
             <button class="btn btn-outline-danger" data-field-action="delete" data-field-id="${f.id}">
               <i class="bi bi-trash"></i>
             </button>
           </div>`
        : `<span class="text-muted small">read-only</span>`;

    return `
      <div class="field-row">
        <div class="min-w-0 flex-grow-1">
          <div class="fw-semibold">${escapeHtml(f.field_label)} ${req}</div>
          <div class="text-muted small">
            <code>${escapeHtml(f.field_key)}</code> · ${escapeHtml(f.field_type)}
            ${f.options ? ` · options: ${escapeHtml(JSON.stringify(f.options))}` : ""}
          </div>
        </div>
        <div>${actions}</div>
      </div>`;
}

// Custom field add / edit / delete
document.getElementById("addCustomFieldBtn").addEventListener("click", () => {
    editingFieldId = null;
    document.getElementById("fieldModalTitle").textContent = "Add Custom Field";
    document.getElementById("fieldForm").reset();
    document.getElementById("fOptionsWrap").style.display = "none";
    clearAlert("fieldAlert");
    fieldModal.show();
});

document.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-field-action]");
    if (!btn) return;
    const fieldId = parseInt(btn.dataset.fieldId, 10);
    const field = currentFields.custom.find(f => f.id === fieldId);
    if (!field) return;

    if (btn.dataset.fieldAction === "edit") {
        editingFieldId = fieldId;
        document.getElementById("fieldModalTitle").textContent = "Edit Custom Field";
        document.getElementById("fLabel").value = field.field_label;
        document.getElementById("fType").value = field.field_type;
        document.getElementById("fPlaceholder").value = field.placeholder || "";
        document.getElementById("fDefaultValue").value = field.default_value || "";
        document.getElementById("fRequired").checked = !!field.is_required;

        if (field.field_type === "select" && field.options) {
            const opts = Array.isArray(field.options)
                ? field.options.join(", ")
                : (field.options.options || []).join(", ");
            document.getElementById("fOptions").value = opts;
            document.getElementById("fOptionsWrap").style.display = "block";
        } else {
            document.getElementById("fOptionsWrap").style.display = "none";
        }

        clearAlert("fieldAlert");
        fieldModal.show();
    }

    if (btn.dataset.fieldAction === "delete") {
        if (!confirm(`Delete custom field "${field.field_label}"?`)) return;
        try {
            await api.del(`/receipt-config/types/${currentType.id}/fields/${fieldId}`);
            toast("Field removed.");
            await loadFields(currentType.id);
            await loadTypes();
        } catch (err) {
            toast(err.message || "Failed to remove field.", "danger");
        }
    }
});

document.getElementById("fType").addEventListener("change", (e) => {
    document.getElementById("fOptionsWrap").style.display =
        e.target.value === "select" ? "block" : "none";
});

document.getElementById("fieldForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAlert("fieldAlert");

    const payload = {
        field_label: document.getElementById("fLabel").value.trim(),
        field_type:  document.getElementById("fType").value,
        placeholder: document.getElementById("fPlaceholder").value.trim() || null,
        default_value: document.getElementById("fDefaultValue").value.trim() || null,
        is_required: document.getElementById("fRequired").checked,
    };

    if (payload.field_type === "select") {
        const opts = document.getElementById("fOptions").value
            .split(",").map(s => s.trim()).filter(Boolean);
        if (opts.length === 0) return setAlert("fieldAlert", "Add at least one option for a dropdown.");
        payload.options = { options: opts };
    }

    if (!payload.field_label) return setAlert("fieldAlert", "Label is required.");

    const btn = document.getElementById("fSubmitBtn");
    btn.disabled = true;
    const orig = btn.textContent;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving…`;

    try {
        if (editingFieldId) {
            await api.put(`/receipt-config/types/${currentType.id}/fields/${editingFieldId}`, payload);
            toast("Field updated.");
        } else {
            await api.post(`/receipt-config/types/${currentType.id}/fields`, payload);
            toast("Field added.");
        }
        fieldModal.hide();
        await loadFields(currentType.id);
        await loadTypes();
    } catch (err) {
        setAlert("fieldAlert", err.message || "Failed to save field.");
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
});

// ---------- APPEARANCE ----------
const PRESET_COLORS = [
    "#0d6efd", "#1e3a8a", "#198754", "#20c997",
    "#ffc107", "#fd7e14", "#dc3545", "#d63384",
    "#6f42c1", "#0dcaf0", "#495057", "#111827",
];

function renderPalette(selected) {
    const wrap = document.getElementById("colorPalette");
    wrap.innerHTML = PRESET_COLORS.map(c => `
      <div class="color-swatch ${c.toLowerCase() === String(selected).toLowerCase() ? "selected" : ""}"
           data-color="${c}" style="background:${c};"></div>
    `).join("");
}

document.getElementById("colorPalette").addEventListener("click", (e) => {
    const sw = e.target.closest(".color-swatch");
    if (!sw) return;
    const c = sw.dataset.color;
    document.getElementById("customColor").value = c;
    document.getElementById("customColorHex").value = c;
    renderPalette(c);
    updatePreview(c);
});

document.getElementById("customColor").addEventListener("input", (e) => {
    document.getElementById("customColorHex").value = e.target.value;
    renderPalette(e.target.value);
    updatePreview(e.target.value);
});

document.getElementById("customColorHex").addEventListener("input", (e) => {
    const v = e.target.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        document.getElementById("customColor").value = v;
        renderPalette(v);
        updatePreview(v);
    }
});

// Local WCAG-safe computation (matches backend's utils/theme.js)
function pickTextColor(hex) {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const toLin = v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    const L = 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
    return L > 0.55 ? "#111827" : "#ffffff";
}
function blendToWhite(hex, t) {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const to = (v) => Math.round(v + (255 - v) * t);
    return "#" + [to(r), to(g), to(b)].map(v => v.toString(16).padStart(2, "0")).join("");
}

function updatePreview(baseColor) {
    const headerText = pickTextColor(baseColor);
    const accent = blendToWhite(baseColor, 0.92);

    document.getElementById("rpHeader").style.background = baseColor;
    document.getElementById("rpHeader").style.color = headerText;

    document.getElementById("rpTotal").style.background = accent;
    document.getElementById("rpTotal").style.color = "#111827";

    document.getElementById("themeHeaderText").textContent = headerText;
    document.getElementById("themeAccent").textContent = accent;
}

async function loadTheme(typeId) {
    try {
        const data = await api.get(`/receipt-config/types/${typeId}/theme`);
        const base = data.base_color || "#0d6efd";
        document.getElementById("customColor").value = base;
        document.getElementById("customColorHex").value = base;
        document.getElementById("retainColor").checked = !!data.is_custom;
        renderPalette(base);
        updatePreview(base);
    } catch (err) {
        toast(err.message || "Failed to load theme.", "danger");
    }
}

document.getElementById("saveThemeBtn").addEventListener("click", async () => {
    if (!currentType) return;
    const base = document.getElementById("customColorHex").value.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(base)) {
        toast("Please pick a valid color.", "danger");
        return;
    }

    const retain = document.getElementById("retainColor").checked;

    const btn = document.getElementById("saveThemeBtn");
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving…`;

    try {
        await api.put(`/receipt-config/types/${currentType.id}/theme`, {
            base_color: base,
            retain_from_last: retain,
        });
        toast("Appearance saved.");
        await loadTypes();
    } catch (err) {
        toast(err.message || "Failed to save.", "danger");
    } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
    }
});

// ---------- TEMPLATES ----------
async function loadTemplates(typeId) {
    const el = document.getElementById("templatesList");
    el.innerHTML = `<div class="p-3 text-muted small">Loading…</div>`;

    try {
        const data = await api.get(`/receipt-config/templates?receipt_type_id=${typeId}`);
        const templates = data.templates || [];

        el.innerHTML = templates.length
            ? templates.map(t => `
                <div class="field-row">
                  <div class="min-w-0">
                    <div class="fw-semibold">${escapeHtml(t.name)}</div>
                    <div class="text-muted small">
                      ${t.default_item_count} default item(s) ·
                      updated ${new Date(t.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                  <a href="/templates.html?edit=${t.id}" class="btn btn-sm btn-outline-secondary">
                    Edit
                  </a>
                </div>
              `).join("")
            : `<div class="p-3 text-muted small">No templates yet for this type.</div>`;
    } catch (err) {
        el.innerHTML = `<div class="p-3 text-danger small">${escapeHtml(err.message)}</div>`;
    }
}

// ---------- BOOT ----------
loadTypes();