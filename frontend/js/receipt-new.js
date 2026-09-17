// ============================================================
// js/receipt-new.js — Create a receipt
// ============================================================

// ---------- State ----------
const state = {
    options: null,          // { types, templates, items, themes, limits }
    currentFields: [],      // fields for the selected type
    items: [],              // line items
    currentTypeTheme: null, // base_color if the type has one
    themeBaseColor: "#0d6efd",
    currency: "NGN",
    lastColorDecision: null, // 'accepted' | 'changed' | null
    customerId: null,       // the saved person this receipt is for, if picked
    customerIndex: new Map(),
};

const navUser = document.getElementById("navUser");
const pageAlert = document.getElementById("pageAlert");
const toastContainer = document.getElementById("toastContainer");

// ---------- Helpers ----------
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
function showAlert(msg, type = "danger") {
    pageAlert.className = `alert alert-${type}`;
    pageAlert.textContent = msg;
    pageAlert.classList.remove("d-none");
    window.scrollTo({ top: 0, behavior: "smooth" });
}
function hideAlert() { pageAlert.classList.add("d-none"); }
function money(n) {
    return Number(n || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
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
function humanise(key) {
    return String(key).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ---------- Auth ----------
let currentUser = null;
let currentStep = 1;
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

// ---------- Load options ----------
async function loadOptions() {
    try {
        const data = await api.get("/receipts/next-options");
        state.options = data;
        state.currency = data.limits.default_currency || "NGN";

        // Populate type dropdown
        const typeSel = document.getElementById("receiptType");
        typeSel.innerHTML = `<option value="">Select a type…</option>` +
            data.types.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");

        // Populate template dropdown (filtered later by type)
        renderTemplateOptions(null);

        // Item suggestions
        const suggestions = document.getElementById("customerSuggestions");
        suggestions.innerHTML = "";   // could be filled from customers API later

        // Payment date default
        document.getElementById("paymentDate").valueAsDate = new Date();

        if (data.types.length === 0) {
            showAlert("No receipt types are enabled for your company. Go to Receipt Types and enable at least one.", "warning");
        }
    } catch (err) {
        showAlert(err.message || "Failed to load options.");
    }
}

// ---------- Type change ----------
document.getElementById("receiptType").addEventListener("change", async (e) => {
    await selectType(parseInt(e.target.value, 10));
});

// Extracted so "start from an earlier receipt" can select the type and have the
// fields rendered before it fills them in.
async function selectType(typeId) {
    hideAlert();
    if (!typeId) {
        document.getElementById("dynamicFieldsCard").classList.add("d-none");
        state.currentFields = [];
        state.currentTypeTheme = null;
        return;
    }

    // Load fields
    try {
        const data = await api.get(`/receipts/type/${typeId}/fields`);
        state.currentFields = data.fields || [];
        state.currentTypeTheme = data.theme_base_color || null;
        renderDynamicFields();
        document.getElementById("dynamicFieldsCard").classList.remove("d-none");
    } catch (err) {
        toast(err.message || "Failed to load fields.", "danger");
    }

    // Filter templates for this type
    renderTemplateOptions(typeId);

    // Color prompt
    handleColorForType(typeId);
}

// ---------- Color handling ----------
function handleColorForType(typeId) {
    const themeInfo = state.options.themes.find(t => t.receipt_type_id === typeId);
    const promptEl = document.getElementById("colorPrompt");

    if (themeInfo?.base_color) {
        state.currentTypeTheme = themeInfo.base_color;
        state.themeBaseColor = themeInfo.base_color;
        applyTheme(themeInfo.base_color);

        // Show prompt
        document.getElementById("colorPromptSwatch").style.background = themeInfo.base_color;
        promptEl.classList.remove("d-none");
        promptEl.classList.add("d-flex");
    } else {
        promptEl.classList.add("d-none");
        promptEl.classList.remove("d-flex");
        state.themeBaseColor = "#0d6efd";
        applyTheme("#0d6efd");
    }
}

document.getElementById("useLastColorBtn").addEventListener("click", () => {
    state.lastColorDecision = "accepted";
    document.getElementById("colorPrompt").classList.add("d-none");
    document.getElementById("colorPrompt").classList.remove("d-flex");
});

document.getElementById("chooseColorBtn").addEventListener("click", () => {
    state.lastColorDecision = "changed";
    document.getElementById("colorPrompt").classList.add("d-none");
    document.getElementById("colorPrompt").classList.remove("d-flex");
    document.getElementById("inlineColorPicker").click();
});

document.getElementById("inlineColorPicker").addEventListener("input", (e) => {
    state.themeBaseColor = e.target.value;
    state.lastColorDecision = "changed";
    applyTheme(e.target.value);
});

function applyTheme(hex) {
    const header = document.getElementById("themeHeader");
    header.style.background = hex;
    header.style.color = pickTextColor(hex);
    document.getElementById("inlineColorPicker").value = hex;
}

// ---------- Templates ----------
function renderTemplateOptions(typeId) {
    const sel = document.getElementById("templateSelect");
    if (!state.options) return;

    const list = typeId
        ? state.options.templates.filter(t => t.receipt_type_id === typeId)
        : state.options.templates;

    sel.innerHTML = `<option value="">No template</option>` +
        list.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");

    const choices = document.getElementById("templateChoices");
    if (!typeId) {
        choices.innerHTML = `<div class="col-12 text-muted small">Choose a receipt type to see its templates.</div>`;
        return;
    }
    choices.innerHTML = `<div class="col-12"><div class="form-text mb-1">Choose a starting point</div></div>` +
        `<div class="col-md-4"><button type="button" class="btn btn-outline-secondary w-100 text-start template-choice" data-template-id=""><strong>Blank receipt</strong><br><small>Start with an empty receipt.</small></button></div>` +
        list.map(t => `<div class="col-md-4"><button type="button" class="btn btn-outline-primary w-100 text-start template-choice" data-template-id="${t.id}"><strong>${escapeHtml(t.name)}</strong><br><small>Use saved defaults and items.</small></button></div>`).join("");
}

document.getElementById("templateChoices").addEventListener("click", (e) => {
    const choice = e.target.closest("[data-template-id]");
    if (!choice) return;
    const select = document.getElementById("templateSelect");
    select.value = choice.dataset.templateId;
    select.dispatchEvent(new Event("change"));
});

document.getElementById("templateSelect").addEventListener("change", async (e) => {
    const templateId = parseInt(e.target.value, 10);
    if (!templateId) return;

    try {
        const { template } = await api.get(`/receipt-config/templates/${templateId}`);

        // Pre-fill field values
        const dv = template.default_field_values || {};
        state.currentFields.forEach(f => {
            const el = document.querySelector(`#dynamicFieldsWrap [data-field-key="${f.field_key}"]`);
            if (!el) return;
            const v = dv[f.field_key];
            if (v === undefined || v === null) return;
            if (el.type === "checkbox") el.checked = !!v;
            else el.value = v;
        });

        // Pre-fill items
        if (Array.isArray(template.default_items) && template.default_items.length) {
            state.items = template.default_items.map(it => ({
                item_id: it.item_id || null,
                item_name: it.item_name,
                description: it.description || "",
                quantity: Number(it.quantity) || 1,
                unit_price: Number(it.unit_price) || 0,
            }));
            renderItems();
            recalcTotals();
        }

        // Notes / footer
        if (template.default_notes) {
            document.getElementById("receiptNotes").value = template.default_notes;
        }

        toast(`Template "${template.name}" applied.`);
    } catch (err) {
        toast(err.message || "Failed to apply template.", "danger");
    }
});

// ---------- Dynamic fields ----------
function renderDynamicFields() {
    const wrap = document.getElementById("dynamicFieldsWrap");
    wrap.innerHTML = state.currentFields.map(f => renderField(f)).join("");
}

function renderField(f) {
    const id = `dyn-${f.field_key}`;
    const required = f.is_required ? "required" : "";
    const label = `${escapeHtml(f.field_label)}${f.is_required ? ' <span class="text-danger">*</span>' : ""}`;
    const key = `data-field-key="${escapeHtml(f.field_key)}"`;
    const ph = f.placeholder ? `placeholder="${escapeHtml(f.placeholder)}"` : "";
    const def = f.default_value ?? "";

    let input;
    switch (f.field_type) {
        case "select": {
            const opts = Array.isArray(f.options) ? f.options : (f.options?.options || []);
            input = `<select class="form-select" id="${id}" ${key} ${required}>
                <option value="">—</option>
                ${opts.map(o => `<option value="${escapeHtml(o)}" ${String(def) === String(o) ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
            </select>`;
            break;
        }
        case "textarea":
            input = `<textarea class="form-control" id="${id}" rows="2" ${key} ${required} ${ph}>${escapeHtml(def)}</textarea>`;
            break;
        case "date":
            input = `<input type="date" class="form-control" id="${id}" ${key} ${required} value="${escapeHtml(def)}">`;
            break;
        case "number":
        case "currency":
            input = `<input type="number" step="0.01" class="form-control" id="${id}" ${key} ${required} ${ph} value="${escapeHtml(def)}">`;
            break;
        case "checkbox":
            return `<div class="col-md-4">
                <div class="form-check mt-4">
                  <input class="form-check-input" type="checkbox" id="${id}" ${key} ${def ? "checked" : ""}>
                  <label class="form-check-label" for="${id}">${label}</label>
                </div>
            </div>`;
        case "email":
            input = `<input type="email" class="form-control" id="${id}" ${key} ${required} ${ph} value="${escapeHtml(def)}">`;
            break;
        case "phone":
            input = `<input type="tel" class="form-control" id="${id}" ${key} ${required} ${ph} value="${escapeHtml(def)}">`;
            break;
        default:
            input = `<input type="text" class="form-control" id="${id}" ${key} ${required} ${ph} value="${escapeHtml(def)}">`;
    }

    return `<div class="col-md-4">
        <label class="form-label" for="${id}">${label}</label>
        ${input}
    </div>`;
}

function collectFieldValues() {
    const out = {};
    document.querySelectorAll("#dynamicFieldsWrap [data-field-key]").forEach(el => {
        const key = el.dataset.fieldKey;
        if (el.type === "checkbox") out[key] = el.checked;
        else out[key] = el.value;
    });
    return out;
}

// ---------- Items ----------
document.getElementById("addItemBtn").addEventListener("click", () => {
    const max = state.options?.limits?.max_receipt_items ?? 10;
    if (state.items.length >= max) {
        toast(`Your plan allows up to ${max} items per receipt.`, "warning");
        return;
    }
    state.items.push({ item_id: null, item_name: "", description: "", quantity: 1, unit_price: 0 });
    renderItems();
    recalcTotals();
    updateItemsUsage();
});

function renderItems() {
    const body = document.getElementById("itemsBody");
    if (state.items.length === 0) {
        body.innerHTML = `<tr><td colspan="5" class="text-muted small text-center py-3">
            No items yet. Click <strong>Add Item</strong>.
        </td></tr>`;
        return;
    }

    // Build catalog options
    const catalogOpts = (state.options?.items || []).map(i =>
        `<option value="${i.id}" data-price="${i.default_price}" data-qty="${i.default_quantity ?? 1}" data-name="${escapeHtml(i.name)}">${escapeHtml(i.name)}</option>`
    ).join("");

    body.innerHTML = state.items.map((it, i) => `
      <tr class="line-item-row" data-row="${i}">
        <td>
          <input type="text" class="form-control form-control-sm mb-1" data-item-name
                 placeholder="Item name" value="${escapeHtml(it.item_name)}">
          <select class="form-select form-select-sm" data-item-catalog>
            <option value="">— pick from catalog —</option>
            ${catalogOpts}
          </select>
        </td>
        <td><input type="number" min="0" step="0.01" class="form-control form-control-sm"
                   data-item-qty value="${it.quantity}"></td>
        <td><input type="number" min="0" step="0.01" class="form-control form-control-sm"
                   data-item-price value="${it.unit_price}"></td>
        <td class="text-end fw-semibold" data-item-total>${money(it.quantity * it.unit_price)}</td>
        <td><button type="button" class="btn btn-sm btn-outline-danger" data-item-remove>
          <i class="bi bi-x"></i></button></td>
      </tr>`).join("");
}

document.getElementById("itemsBody").addEventListener("input", (e) => {
    const row = e.target.closest("[data-row]");
    if (!row) return;
    const i = parseInt(row.dataset.row, 10);

    if (e.target.matches("[data-item-name]"))       state.items[i].item_name = e.target.value;
    if (e.target.matches("[data-item-qty]"))        state.items[i].quantity = parseFloat(e.target.value) || 0;
    if (e.target.matches("[data-item-price]"))      state.items[i].unit_price = parseFloat(e.target.value) || 0;

    const total = state.items[i].quantity * state.items[i].unit_price;
    row.querySelector("[data-item-total]").textContent = money(total);
    recalcTotals();
});

document.getElementById("itemsBody").addEventListener("change", (e) => {
    if (!e.target.matches("[data-item-catalog]")) return;
    const row = e.target.closest("[data-row]");
    const i = parseInt(row.dataset.row, 10);
    const opt = e.target.selectedOptions[0];
    if (!opt.value) return;

    state.items[i].item_id = parseInt(opt.value, 10);
    state.items[i].item_name = opt.dataset.name;
    state.items[i].unit_price = parseFloat(opt.dataset.price) || 0;
    // Products carry the quantity they are normally sold in, if one was set.
    const defaultQty = parseFloat(opt.dataset.qty);
    state.items[i].quantity = Number.isFinite(defaultQty) && defaultQty > 0 ? defaultQty : 1;
    row.querySelector("[data-item-name]").value = state.items[i].item_name;
    row.querySelector("[data-item-price]").value = state.items[i].unit_price;
    row.querySelector("[data-item-qty]").value = state.items[i].quantity;
    row.querySelector("[data-item-total]").textContent = money(state.items[i].quantity * state.items[i].unit_price);
    recalcTotals();
});

document.getElementById("itemsBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-item-remove]");
    if (!btn) return;
    const row = btn.closest("[data-row]");
    const i = parseInt(row.dataset.row, 10);
    state.items.splice(i, 1);
    renderItems();
    recalcTotals();
    updateItemsUsage();
});

function updateItemsUsage() {
    const max = state.options?.limits?.max_receipt_items ?? 10;
    document.getElementById("itemsUsage").textContent = `${state.items.length} / ${max}`;
}

// ---------- Money ----------
document.getElementById("discountType").addEventListener("change", (e) => {
    const v = document.getElementById("discountValue");
    if (e.target.value) { v.disabled = false; if (!v.value) v.value = 0; }
    else { v.disabled = true; v.value = ""; }
    recalcTotals();
});

document.getElementById("discountValue").addEventListener("input", recalcTotals);
document.getElementById("amountPaid").addEventListener("input", recalcTotals);

function recalcTotals() {
    let subtotal = 0;
    state.items.forEach(it => { subtotal += (it.quantity * it.unit_price); });
    subtotal = Math.round(subtotal * 100) / 100;

    const dtype = document.getElementById("discountType").value;
    const dval = parseFloat(document.getElementById("discountValue").value) || 0;
    let discount_amount = 0;
    if (dtype === "fixed") discount_amount = Math.max(0, dval);
    else if (dtype === "percent") discount_amount = Math.round(subtotal * Math.max(0, Math.min(100, dval))) / 100;
    discount_amount = Math.min(discount_amount, subtotal);

    const total = Math.round((subtotal - discount_amount) * 100) / 100;
    const paid = Math.max(0, parseFloat(document.getElementById("amountPaid").value) || 0);
    const balance = Math.max(0, Math.round((total - paid) * 100) / 100);

    let status = "unpaid";
    if (paid <= 0) status = "unpaid";
    else if (paid >= total) status = "paid";
    else status = "partial";

    document.getElementById("sumSubtotal").textContent = money(subtotal);
    document.getElementById("sumDiscount").textContent = money(discount_amount);
    document.getElementById("sumTotal").textContent = money(total);
    document.getElementById("sumPaid").textContent = money(paid);
    document.getElementById("sumBalance").textContent = money(balance);

    const statusEl = document.getElementById("sumStatus");
    statusEl.textContent = status.toUpperCase();
    statusEl.className = "badge " + ({
        paid:    "badge-soft-success",
        partial: "badge-soft-warning",
        unpaid:  "badge-soft-danger",
    }[status] || "badge-soft-muted");

    document.getElementById("reviewTotal").textContent = money(total);
    document.getElementById("reviewPaid").textContent = money(paid);
    document.getElementById("reviewBalance").textContent = money(balance);
}

function showStep(step) {
    currentStep = step;
    document.querySelectorAll("[data-step]").forEach(el => {
        el.classList.toggle("d-none", Number(el.dataset.step) !== step);
    });
    document.querySelectorAll("[data-step-indicator]").forEach(el => {
        el.classList.toggle("active", Number(el.dataset.stepIndicator) === step);
    });
    document.getElementById("backBtn").classList.toggle("d-none", step === 1);
    document.getElementById("nextBtn").classList.toggle("d-none", step === 4);
    document.getElementById("saveBtn").classList.toggle("d-none", step !== 4);
    if (step === 4) updateReview();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateReview() {
    const selectedType = document.getElementById("receiptType").selectedOptions[0];
    document.getElementById("reviewType").textContent = selectedType?.textContent || "Receipt";
    const customer = document.getElementById("custName").value.trim();
    const items = state.items.filter(item => item.item_name && item.item_name.trim()).length;
    document.getElementById("reviewCustomer").textContent = `${customer || "No customer name"} · ${items} item${items === 1 ? "" : "s"}`;
}

function validateCurrentStep() {
    if (currentStep === 1 && !document.getElementById("receiptType").value) {
        showAlert("Choose a receipt type to continue.");
        return false;
    }
    if (currentStep === 2) {
        const required = [...document.querySelectorAll('[data-step="2"] [required]')];
        const invalid = required.find(input => !input.checkValidity());
        if (invalid) { invalid.reportValidity(); return false; }
    }
    if (currentStep === 3 && !state.items.some(item => item.item_name && item.item_name.trim())) {
        showAlert("Add at least one item before reviewing the receipt.");
        return false;
    }
    return true;
}

document.getElementById("nextBtn").addEventListener("click", () => {
    hideAlert();
    if (validateCurrentStep()) showStep(currentStep + 1);
});
document.getElementById("backBtn").addEventListener("click", () => showStep(currentStep - 1));

// ---------- Submit ----------
document.getElementById("receiptForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAlert();

    const typeId = parseInt(document.getElementById("receiptType").value, 10);
    if (!typeId) return showAlert("Please choose a receipt type.");

    const validItems = state.items
        .filter(it => it.item_name && it.item_name.trim())
        .map(it => ({
            item_id: it.item_id || null,
            item_name: it.item_name.trim(),
            description: it.description || null,
            quantity: Number(it.quantity) || 0,
            unit_price: Number(it.unit_price) || 0,
        }));

    if (validItems.length === 0) return showAlert("Add at least one item.");

    const payload = {
        receipt_type_id: typeId,
        template_id: parseInt(document.getElementById("templateSelect").value, 10) || null,
        field_values: collectFieldValues(),
        customer_name: document.getElementById("custName").value.trim() || null,
        customer_phone: document.getElementById("custPhone").value.trim() || null,
        customer_email: document.getElementById("custEmail").value.trim() || null,
        // Present only when a saved person was picked: lets the server save any
        // corrections back to their record.
        customer_id: state.customerId || null,
        items: validItems,
        discount_type: document.getElementById("discountType").value || null,
        discount_value: parseFloat(document.getElementById("discountValue").value) || 0,
        payment_method: document.getElementById("paymentMethod").value || null,
        amount_paid: parseFloat(document.getElementById("amountPaid").value) || 0,
        payment_reference: document.getElementById("paymentReference").value.trim() || null,
        payment_date: document.getElementById("paymentDate").value || null,
        notes: document.getElementById("receiptNotes").value.trim() || null,
        theme_base_color: state.themeBaseColor,
    };

    const btn = document.getElementById("saveBtn");
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving…`;

    try {
        const data = await api.post("/receipts", payload);
        toast(`Receipt ${data.receipt.receipt_number} saved.`);
        window.location.href = `/receipt-view.html?id=${data.receipt.id}&print=1`;
    } catch (err) {
        showAlert(err.message || "Failed to save receipt.");
        btn.disabled = false;
        btn.innerHTML = orig;
    }
});

// ---------- Boot ----------
(async function boot() {
    await loadOptions();
    updateItemsUsage();
    recalcTotals();
    showStep(1);

    // "Create another like this" sends the user here with the id of the receipt
    // to copy. The original is never modified.
    const fromId = parseInt(new URLSearchParams(window.location.search).get("from"), 10);
    if (fromId) await startFromReceipt(fromId);
})();

// ---------- Start from an earlier receipt ----------
async function startFromReceipt(receiptId) {
    try {
        const { basis } = await api.get(`/receipts/${receiptId}/basis`);

        // Select the type first: the detail fields must exist before values can
        // be placed into them.
        document.getElementById("receiptType").value = basis.receipt_type_id;
        await selectType(basis.receipt_type_id);
        document.getElementById("templateSelect").value = basis.template_id || "";

        state.items = (basis.items || []).map(item => ({
            item_id: item.item_id || null,
            item_name: item.item_name || "",
            description: item.description || "",
            quantity: Number(item.quantity) || 1,
            unit_price: Number(item.unit_price) || 0,
        }));
        renderItems();
        updateItemsUsage();

        if (basis.discount_type) {
            document.getElementById("discountType").value = basis.discount_type;
            const discountValue = document.getElementById("discountValue");
            discountValue.disabled = false;
            discountValue.value = Number(basis.discount_value) || 0;
        }
        if (basis.payment_method) {
            document.getElementById("paymentMethod").value = basis.payment_method;
        }

        // Details that describe the transaction rather than the person carry over
        // (the session being billed, the fee category). The person's own details
        // are filled in when their name is chosen.
        for (const [key, value] of Object.entries(basis.field_values || {})) {
            const el = document.querySelector(`#dynamicFieldsWrap [data-field-key="${key}"]`);
            if (!el) continue;
            if (el.type === "checkbox") el.checked = Boolean(value);
            else el.value = value;
        }

        recalcTotals();

        document.getElementById("basisNoticeTitle").textContent =
            `Copied from receipt ${basis.source_receipt_number}`;
        const notice = document.getElementById("basisNotice");
        notice.classList.remove("d-none");
        notice.classList.add("d-flex");

        toast("Copied the earlier receipt. Change the name to issue it for someone else.", "success");
    } catch (err) {
        showAlert(err.message || "Could not copy that receipt.");
    }
}

// ---------- Person lookup ----------
// Typing a saved person's name fills in their reference, class and contact
// details, so nobody retypes information the company already has.
let personSearchTimer = null;

function customerFieldValues(customer) {
    return {
        // Names differ per receipt type: a student, a tenant, a patient.
        student_name: customer.full_name,
        customer_name: customer.full_name,
        payer_name: customer.full_name,
        tenant_name: customer.full_name,
        patient_name: customer.full_name,
        participant_name: customer.full_name,
        guest_name: customer.full_name,
        donor_name: customer.full_name,
        client_name: customer.full_name,
        // References likewise.
        student_id: customer.external_ref,
        patient_id: customer.external_ref,
        member_id: customer.external_ref,
        member_no: customer.external_ref,
        tenant_code: customer.external_ref,
        registration_number: customer.external_ref,
        customer_phone: customer.phone,
        phone: customer.phone,
        customer_email: customer.email,
        email: customer.email,
        // Whatever else the company chose to remember (class, house, property).
        ...(customer.profiles || {}),
    };
}

function applyCustomer(customer) {
    state.customerId = customer.id;

    document.getElementById("custName").value = customer.full_name;
    if (customer.phone) document.getElementById("custPhone").value = customer.phone;
    if (customer.email) document.getElementById("custEmail").value = customer.email;

    for (const [key, value] of Object.entries(customerFieldValues(customer))) {
        if (value === null || value === undefined || value === "") continue;
        const el = document.querySelector(`#dynamicFieldsWrap [data-field-key="${key}"]`);
        if (!el) continue;
        if (el.type === "checkbox") el.checked = Boolean(value);
        else el.value = value;
    }

    const details = Object.entries(customer.profiles || {})
        .map(([key, value]) => `${escapeHtml(humanise(key))}: <strong>${escapeHtml(value)}</strong>`)
        .join(" · ");

    const notice = document.getElementById("personNotice");
    notice.innerHTML = `<i class="bi bi-person-check me-1"></i>
        Filled in from your records for <strong>${escapeHtml(customer.full_name)}</strong>${
            customer.external_ref ? ` (${escapeHtml(customer.external_ref)})` : ""}.
        ${details ? `<div class="small mt-1">${details}</div>` : ""}
        <div class="small mt-1">
          Change anything that is out of date — it is saved back to their record when you issue this receipt.
        </div>`;
    notice.classList.remove("d-none");
}

async function searchPeople(term) {
    try {
        const { customers } = await api.get(`/customers/search?q=${encodeURIComponent(term)}`);

        document.getElementById("customerSuggestions").innerHTML =
            customers.map(c => `<option value="${escapeHtml(c.full_name)}"></option>`).join("");
        customers.forEach(c => state.customerIndex.set(c.full_name.toLowerCase(), c));

        const exact = customers.find(c => c.full_name.toLowerCase() === term.toLowerCase());
        if (exact) applyCustomer(exact);
    } catch {
        // A failed lookup must never stop someone issuing a receipt.
    }
}

document.getElementById("custName").addEventListener("input", (e) => {
    const term = e.target.value.trim();

    // Typing a name we do not have saved means this is no longer that person.
    if (state.customerIndex.size && !state.customerIndex.has(term.toLowerCase())) {
        state.customerId = null;
        document.getElementById("personNotice").classList.add("d-none");
    }

    if (term.length < 2) return;
    clearTimeout(personSearchTimer);
    personSearchTimer = setTimeout(() => searchPeople(term), 250);
});
