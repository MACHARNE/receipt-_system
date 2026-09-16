// ============================================================
// js/superadmin.js — Super Admin dashboard logic
// ============================================================

// ---------- State ----------
let companies = [];
let plans = [];
let changePlanTarget = null;
let editLimitsTarget = null;
let resetPasswordTarget = null;
let editCompanyTarget = null;   // company being edited (list row)
let editCompanyDetail = null;   // full record returned by GET /superadmin/companies/:id
let abbrTouched = false;        // true once the admin types their own abbreviation

// ---------- Element refs ----------
const companiesBody = document.getElementById("companiesBody");
const navUser       = document.getElementById("navUser");
const toastContainer = document.getElementById("toastContainer");

// Modals
const newCompanyModal     = new bootstrap.Modal("#newCompanyModal");
const changePlanModal     = new bootstrap.Modal("#changePlanModal");
const editLimitsModal     = new bootstrap.Modal("#editLimitsModal");
const resetPasswordModal  = new bootstrap.Modal("#resetPasswordModal");
const editCompanyModal    = new bootstrap.Modal("#editCompanyModal");
const credentialsModal    = new bootstrap.Modal("#credentialsModal");

// ---------- Helpers ----------
function toast(message, type = "success") {
    const id = "t" + Date.now();
    const el = document.createElement("div");
    el.className = `toast align-items-center text-bg-${type} border-0`;
    el.id = id;
    el.role = "alert";
    el.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">${escapeHtml(message)}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>`;
    toastContainer.appendChild(el);
    const t = new bootstrap.Toast(el, { delay: 4000 });
    t.show();
    el.addEventListener("hidden.bs.toast", () => el.remove());
}

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function daysUntil(iso) {
    if (!iso) return null;
    const diff = Math.ceil((new Date(iso) - new Date()) / (1000 * 60 * 60 * 24));
    return diff;
}

function setAlert(elId, message, type = "danger") {
    const el = document.getElementById(elId);
    el.className = `alert alert-${type}`;
    el.textContent = message;
    el.classList.remove("d-none");
}
function clearAlert(elId) {
    document.getElementById(elId).classList.add("d-none");
}

// ---------- Auth guard ----------
(async function guard() {
    try {
        const { user: me } = await api.get("/auth/me");
        if (me.role !== "super_admin") {
            window.location.href = "/dashboard.html";
            return;
        }
        navUser.textContent = me.full_name || "";
    } catch {
        window.location.href = "/index.html";
    }
})();

// ---------- Logout ----------
document.getElementById("logoutBtn").addEventListener("click", async () => {
    try { await api.post("/auth/logout"); } catch {}
    window.location.href = "/index.html";
});

// ============================================================
// LOAD PLANS
// ============================================================
async function loadPlans() {
    try {
        const data = await api.get("/superadmin/plans");
        plans = data.plans || [];
        populatePlanSelect("ncPlan", "Select a plan");
        populatePlanSelect("cpPlan", "Select a new plan");
    } catch (err) {
        toast(err.message || "Failed to load plans", "danger");
    }
}

function populatePlanSelect(selectId, placeholder) {
    const sel = document.getElementById(selectId);
    sel.innerHTML = `<option value="">${placeholder}</option>` +
        plans.map(p =>
            `<option value="${escapeHtml(p.code)}">
                ${escapeHtml(p.name)} — ₦${Number(p.price).toLocaleString()} / ${p.duration_days}d
             </option>`
        ).join("");
}

// ============================================================
// LOAD COMPANIES
// ============================================================
async function loadCompanies() {
    companiesBody.innerHTML = `
      <tr><td colspan="8" class="empty-state">
        <div class="spinner-border spinner-border-sm"></div>
        <div class="mt-2">Loading companies…</div>
      </td></tr>`;

    try {
        const data = await api.get("/superadmin/companies");
        companies = data.companies || [];
        renderCompanies();
        renderStats();
    } catch (err) {
        companiesBody.innerHTML = `
          <tr><td colspan="8" class="empty-state text-danger">
            <i class="bi bi-exclamation-triangle"></i>
            ${escapeHtml(err.message || "Failed to load companies")}
          </td></tr>`;
    }
}

// ============================================================
// RENDER
// ============================================================
function renderCompanies() {
    if (companies.length === 0) {
        companiesBody.innerHTML = `
          <tr><td colspan="8" class="empty-state">
            <i class="bi bi-building"></i>
            <div>No companies yet</div>
            <div class="small">Click <strong>New Company</strong> to create the first one.</div>
          </td></tr>`;
        return;
    }

    companiesBody.innerHTML = companies.map((c, i) => {
        const days = daysUntil(c.plan_expires_at);
        const expired = days !== null && days < 0;
        const soon = days !== null && days >= 0 && days <= 30;

        let statusBadge;
        if (!c.is_active) {
            statusBadge = `<span class="badge badge-soft-danger">Disabled</span>`;
        } else if (expired) {
            statusBadge = `<span class="badge badge-soft-danger">Expired</span>`;
        } else if (soon) {
            statusBadge = `<span class="badge badge-soft-warning">Expiring in ${days}d</span>`;
        } else {
            statusBadge = `<span class="badge badge-soft-success">Active</span>`;
        }

        const planLabel = c.plan_name
            ? `${escapeHtml(c.plan_name)} <span class="text-muted small">· until ${fmtDate(c.plan_expires_at)}</span>`
            : `<span class="text-muted">—</span>`;

        const ownerLabel = c.owner_email
            ? `<div class="small">${escapeHtml(c.owner_email)}</div>`
            : `<span class="text-muted small">No owner</span>`;

        return `
          <tr>
            <td>${i + 1}</td>
            <td>
              <div class="fw-semibold">${escapeHtml(c.name)}</div>
              <div class="text-muted small d-md-none">${escapeHtml(c.abbreviation || "")}</div>
            </td>
            <td class="d-none d-md-table-cell">
              <code>${escapeHtml(c.abbreviation || "—")}</code>
            </td>
            <td class="d-none d-md-table-cell">${planLabel}</td>
            <td class="d-none d-lg-table-cell">${ownerLabel}</td>
            <td class="d-none d-lg-table-cell">
              <div class="small text-muted">
                Products: <strong>${c.max_products}</strong><br>
                Items/Receipt: <strong>${c.max_receipt_items}</strong>
              </div>
            </td>
            <td>${statusBadge}</td>
            <td class="text-end">
              <div class="btn-group btn-group-sm">
                <button class="btn btn-outline-secondary" data-action="edit"   data-id="${c.id}" title="Company details, logo and branding">
                  <i class="bi bi-pencil-square"></i>
                </button>
                <button class="btn btn-outline-secondary" data-action="plan"   data-id="${c.id}" title="Change plan">
                  <i class="bi bi-credit-card"></i>
                </button>
                <button class="btn btn-outline-secondary" data-action="limits" data-id="${c.id}" title="Edit limits">
                  <i class="bi bi-sliders"></i>
                </button>
                <button class="btn btn-outline-secondary" data-action="reset"  data-id="${c.id}" title="Reset owner password">
                  <i class="bi bi-key"></i>
                </button>
                <button class="btn btn-outline-${c.is_active ? 'danger' : 'success'}"
                        data-action="toggle" data-id="${c.id}"
                        title="${c.is_active ? 'Disable' : 'Enable'}">
                  <i class="bi bi-${c.is_active ? 'pause-circle' : 'play-circle'}"></i>
                </button>
              </div>
            </td>
          </tr>`;
    }).join("");
}

function renderStats() {
    const total = companies.length;
    const active = companies.filter(c => c.is_active && !isExpired(c)).length;
    const disabled = companies.filter(c => !c.is_active).length;
    const expiring = companies.filter(c => {
        const d = daysUntil(c.plan_expires_at);
        return c.is_active && d !== null && d >= 0 && d <= 30;
    }).length;

    document.getElementById("statTotal").textContent = total;
    document.getElementById("statActive").textContent = active;
    document.getElementById("statExpiring").textContent = expiring;
    document.getElementById("statDisabled").textContent = disabled;
}

function isExpired(c) {
    const d = daysUntil(c.plan_expires_at);
    return d !== null && d < 0;
}

// ============================================================
// NEW COMPANY
// ============================================================
document.getElementById("newCompanyBtn").addEventListener("click", () => {
    document.getElementById("newCompanyForm").reset();
    // Fresh form: let the company name suggest the abbreviation again.
    abbrTouched = false;
    clearAlert("newCompanyAlert");
    newCompanyModal.show();
});

// Uppercase abbreviation as user types
document.getElementById("ncAbbr").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

// The abbreviation is suggested from the company name only until the admin
// types their own. Previously the suggestion fired on blur, which could land
// after the admin started typing and silently corrupt the value (for example
// "ZUTC" + "ZZUIC"). It now follows the name live and yields on first edit.
function suggestAbbreviation(name) {
    const words = String(name).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "";
    const raw = words.length > 1 ? words.map(w => w[0]).join("") : words[0].substring(0, 4);
    return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 6);
}

document.getElementById("ncAbbr").addEventListener("input", () => {
    abbrTouched = true;
});

document.getElementById("ncName").addEventListener("input", (e) => {
    if (abbrTouched) return;
    document.getElementById("ncAbbr").value = suggestAbbreviation(e.target.value);
});

// Toggle owner password visibility
document.getElementById("toggleOwnerPass").addEventListener("click", () => {
    const input = document.getElementById("ncOwnerPassword");
    const icon = document.getElementById("toggleOwnerPassIcon");
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    icon.className = showing ? "bi bi-eye" : "bi bi-eye-slash";
});

// Submit
document.getElementById("newCompanyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAlert("newCompanyAlert");

    const btn = document.getElementById("ncSubmitBtn");
    const payload = {
        companyName:  document.getElementById("ncName").value.trim(),
        abbreviation: document.getElementById("ncAbbr").value.trim(),
        companyEmail: document.getElementById("ncEmail").value.trim() || undefined,
        companyPhone: document.getElementById("ncPhone").value.trim() || undefined,
        planCode:     document.getElementById("ncPlan").value,
        ownerFullName: document.getElementById("ncOwnerName").value.trim(),
        ownerEmail:    document.getElementById("ncOwnerEmail").value.trim(),
        // Blank means "let the server generate a strong password".
        ownerPassword: document.getElementById("ncOwnerPassword").value,
    };

    // Optional overrides
    const mp = document.getElementById("ncMaxProducts").value.trim();
    const mr = document.getElementById("ncMaxReceiptItems").value.trim();
    if (mp) payload.maxProducts = parseInt(mp, 10);
    if (mr) payload.maxReceiptItems = parseInt(mr, 10);

    // Client-side validation (server still validates)
    if (!payload.companyName || !payload.abbreviation || !payload.planCode ||
        !payload.ownerFullName || !payload.ownerEmail) {
        setAlert("newCompanyAlert", "Please fill in all required fields.");
        return;
    }
    if (payload.ownerPassword && payload.ownerPassword.length < 8) {
        setAlert("newCompanyAlert",
            "A password you type in must be at least 8 characters, or leave it blank to generate a secure one.");
        return;
    }

    btn.disabled = true;
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Creating…`;

    try {
        const data = await api.post("/superadmin/companies", payload);
        const logoFile = document.getElementById("ncLogo").files[0];
        if (logoFile) {
            const formData = new FormData();
            formData.append("logo", logoFile);
            try {
                await api.post(`/superadmin/companies/${data.company.id}/logo`, formData);
            } catch (logoError) {
                toast(`Company created, but its logo could not be uploaded: ${logoError.message}`, "warning");
            }
        }
        newCompanyModal.hide();
        toast(`Company "${data.company.name}" created.`, "success");
        await loadCompanies();

        // When the server generated the password it is returned once, here.
        if (data.owner && data.owner.password) {
            showCredentials({
                companyName: data.company.name,
                email: data.owner.email,
                password: data.owner.password,
            });
        }
    } catch (err) {
        setAlert("newCompanyAlert", err.message || "Failed to create company.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
    }
});

// ============================================================
// TABLE ACTION DELEGATION
// ============================================================
companiesBody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;
    const id = parseInt(btn.dataset.id, 10);
    const company = companies.find(c => c.id === id);
    if (!company) return;

    if (action === "edit") {
        editCompanyTarget = company;
        editCompanyDetail = null;
        clearAlert("editCompanyAlert");
        document.getElementById("ecLogo").value = "";
        // Show the modal straight away, then fill in the full record.
        editCompanyModal.show();
        await loadCompanyDetail(company.id);
    }

    if (action === "plan") {
        changePlanTarget = company;
        document.getElementById("cpCompanyName").textContent = company.name;
        document.getElementById("cpPlan").value = company.plan_code || "";
        clearAlert("changePlanAlert");
        changePlanModal.show();
    }

    if (action === "limits") {
        editLimitsTarget = company;
        document.getElementById("elCompanyName").textContent = company.name;
        document.getElementById("elMaxProducts").value = company.max_products;
        document.getElementById("elMaxReceiptItems").value = company.max_receipt_items;
        clearAlert("editLimitsAlert");
        editLimitsModal.show();
    }

    if (action === "reset") {
        resetPasswordTarget = company;
        document.getElementById("rpCompanyName").textContent = company.name;
        document.getElementById("rpOwnerEmail").textContent = company.owner_email || "—";
        document.getElementById("rpNewPassword").value = "";
        clearAlert("resetPasswordAlert");
        resetPasswordModal.show();
    }

    if (action === "toggle") {
        const next = !company.is_active;
        const verb = next ? "enable" : "disable";
        if (!confirm(`Are you sure you want to ${verb} "${company.name}"?`)) return;

        try {
            await api.put(`/superadmin/companies/${company.id}/status`, { isActive: next });
            toast(`Company ${verb}d.`, "success");
            await loadCompanies();
        } catch (err) {
            toast(err.message || "Failed to update status.", "danger");
        }
    }
});

// ============================================================
// CHANGE PLAN SUBMIT
// ============================================================
document.getElementById("changePlanForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!changePlanTarget) return;
    clearAlert("changePlanAlert");

    const planCode = document.getElementById("cpPlan").value;
    if (!planCode) {
        setAlert("changePlanAlert", "Please choose a plan.");
        return;
    }

    const btn = document.getElementById("cpSubmitBtn");
    btn.disabled = true;
    const orig = btn.textContent;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving…`;

    try {
        await api.put(`/superadmin/companies/${changePlanTarget.id}/plan`, { planCode });
        changePlanModal.hide();
        toast("Plan updated.", "success");
        await loadCompanies();
    } catch (err) {
        setAlert("changePlanAlert", err.message || "Failed to update plan.");
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
});

// ============================================================
// EDIT LIMITS SUBMIT
// ============================================================
document.getElementById("editLimitsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!editLimitsTarget) return;
    clearAlert("editLimitsAlert");

    const maxProducts = parseInt(document.getElementById("elMaxProducts").value, 10);
    const maxReceiptItems = parseInt(document.getElementById("elMaxReceiptItems").value, 10);

    if (!Number.isInteger(maxProducts) || maxProducts < 1 ||
        !Number.isInteger(maxReceiptItems) || maxReceiptItems < 1) {
        setAlert("editLimitsAlert", "Limits must be positive whole numbers.");
        return;
    }

    const btn = document.getElementById("elSubmitBtn");
    btn.disabled = true;
    const orig = btn.textContent;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving…`;

    try {
        await api.put(`/superadmin/companies/${editLimitsTarget.id}/limits`, {
            maxProducts, maxReceiptItems,
        });
        editLimitsModal.hide();
        toast("Limits updated.", "success");
        await loadCompanies();
    } catch (err) {
        setAlert("editLimitsAlert", err.message || "Failed to update limits.");
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
});

// ============================================================
// RESET PASSWORD SUBMIT
// ============================================================
document.getElementById("toggleRpPass").addEventListener("click", () => {
    const input = document.getElementById("rpNewPassword");
    const icon = document.getElementById("toggleRpPassIcon");
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    icon.className = showing ? "bi bi-eye" : "bi bi-eye-slash";
});

document.getElementById("resetPasswordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!resetPasswordTarget) return;
    clearAlert("resetPasswordAlert");

    const newPassword = document.getElementById("rpNewPassword").value;
    if (newPassword && newPassword.length < 8) {
        setAlert("resetPasswordAlert",
            "A password you type in must be at least 8 characters, or leave it blank to generate a secure one.");
        return;
    }

    const btn = document.getElementById("rpSubmitBtn");
    btn.disabled = true;
    const orig = btn.textContent;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Resetting…`;

    try {
        const data = await api.post(
            `/superadmin/companies/${resetPasswordTarget.id}/reset-owner-password`,
            newPassword ? { newPassword } : {});

        resetPasswordModal.hide();

        if (data.password) {
            showCredentials({
                companyName: resetPasswordTarget.name,
                email: resetPasswordTarget.owner_email,
                password: data.password,
            });
        } else {
            toast("Owner password updated.", "success");
        }
    } catch (err) {
        setAlert("resetPasswordAlert", err.message || "Failed to reset password.");
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
});

// ============================================================
// COMPANY DETAILS EDITOR
// ============================================================
async function loadCompanyDetail(id) {
    try {
        const { company: detail } = await api.get(`/superadmin/companies/${id}`);
        editCompanyDetail = detail;
        populateEditCompany(detail);
    } catch (err) {
        setAlert("editCompanyAlert", err.message || "Failed to load company details.");
    }
}

function populateEditCompany(c) {
    document.getElementById("ecName").value          = c.name || "";
    document.getElementById("ecAbbreviation").value  = c.abbreviation || "";
    document.getElementById("ecEmail").value         = c.email || "";
    document.getElementById("ecPhone").value         = c.phone || "";
    document.getElementById("ecWebsite").value       = c.website || "";
    document.getElementById("ecTin").value           = c.tin || "";
    document.getElementById("ecCac").value           = c.cac_number || "";
    document.getElementById("ecAddress").value       = c.address || "";
    document.getElementById("ecHeaderPosition").value = c.header_position || "left";
    document.getElementById("ecCurrency").value      = c.default_currency || "NGN";
    document.getElementById("ecFooter").value        = c.receipt_footer || "";
    document.getElementById("ecWatermark").checked   = !!c.use_logo_watermark;
    showLogoPreview(c.logo_path);
}

function showLogoPreview(logoPath) {
    const img      = document.getElementById("ecLogoPreview");
    const empty    = document.getElementById("ecLogoEmpty");
    const removeBtn = document.getElementById("ecRemoveLogo");

    if (logoPath && editCompanyTarget) {
        img.src = `/superadmin/companies/${editCompanyTarget.id}/logo?t=${Date.now()}`;
        img.classList.remove("d-none");
        empty.classList.add("d-none");
        removeBtn.classList.remove("d-none");
    } else {
        img.removeAttribute("src");
        img.classList.add("d-none");
        empty.classList.remove("d-none");
        removeBtn.classList.add("d-none");
    }
}

document.getElementById("editCompanyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!editCompanyTarget) return;
    clearAlert("editCompanyAlert");

    const payload = {
        name:              document.getElementById("ecName").value.trim(),
        abbreviation:      document.getElementById("ecAbbreviation").value.trim().toUpperCase(),
        email:             document.getElementById("ecEmail").value.trim(),
        phone:             document.getElementById("ecPhone").value.trim(),
        website:           document.getElementById("ecWebsite").value.trim(),
        tin:               document.getElementById("ecTin").value.trim(),
        cac_number:        document.getElementById("ecCac").value.trim(),
        address:           document.getElementById("ecAddress").value.trim(),
        header_position:   document.getElementById("ecHeaderPosition").value,
        default_currency:  document.getElementById("ecCurrency").value.trim().toUpperCase(),
        receipt_footer:    document.getElementById("ecFooter").value.trim(),
        use_logo_watermark: document.getElementById("ecWatermark").checked,
    };

    if (!payload.name) {
        setAlert("editCompanyAlert", "Company name is required.");
        return;
    }
    if (!/^[A-Z0-9]{2,10}$/.test(payload.abbreviation)) {
        setAlert("editCompanyAlert", "Abbreviation must be 2–10 letters or numbers, with no spaces.");
        return;
    }
    if (payload.default_currency && !/^[A-Z]{3}$/.test(payload.default_currency)) {
        setAlert("editCompanyAlert", "Currency must be a three-letter code, for example NGN.");
        return;
    }

    const fileInput = document.getElementById("ecLogo");
    const btn = document.getElementById("ecSubmitBtn");
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving…`;

    try {
        await api.put(`/superadmin/companies/${editCompanyTarget.id}/settings`, payload);

        if (fileInput.files && fileInput.files[0]) {
            const formData = new FormData();
            formData.append("logo", fileInput.files[0]);
            await api.post(`/superadmin/companies/${editCompanyTarget.id}/logo`, formData);
        }

        editCompanyModal.hide();
        toast("Company details saved.", "success");
        await loadCompanies();
    } catch (err) {
        setAlert("editCompanyAlert", err.message || "Failed to save company details.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
    }
});

document.getElementById("ecRemoveLogo").addEventListener("click", async () => {
    if (!editCompanyTarget) return;
    if (!confirm("Remove this company's logo from future receipts?")) return;

    try {
        await api.del(`/superadmin/companies/${editCompanyTarget.id}/logo`);
        document.getElementById("ecLogo").value = "";
        showLogoPreview(null);
        toast("Logo removed.", "success");
    } catch (err) {
        setAlert("editCompanyAlert", err.message || "Failed to remove the logo.");
    }
});

// ============================================================
// GENERATED CREDENTIALS
// ============================================================
function showCredentials({ companyName, email, password }) {
    document.getElementById("credCompany").textContent = companyName || "—";
    document.getElementById("credEmail").value = email || "";
    document.getElementById("credPassword").value = password || "";
    credentialsModal.show();
}

// navigator.clipboard needs a secure context, so keep a plain-http fallback.
async function copyText(text, button) {
    let copied = false;

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            copied = true;
        }
    } catch { copied = false; }

    if (!copied) {
        const scratch = document.createElement("textarea");
        scratch.value = text;
        scratch.setAttribute("readonly", "");
        scratch.style.position = "fixed";
        scratch.style.opacity = "0";
        document.body.appendChild(scratch);
        scratch.select();
        try { copied = document.execCommand("copy"); } catch { copied = false; }
        scratch.remove();
    }

    if (!copied) {
        toast("Could not copy automatically — select the text and copy it manually.", "warning");
        return;
    }

    const icon = button.querySelector("i");
    if (!icon) return;
    const original = icon.className;
    icon.className = "bi bi-check2";
    setTimeout(() => { icon.className = original; }, 1500);
}

document.getElementById("copyEmailBtn").addEventListener("click", (e) =>
    copyText(document.getElementById("credEmail").value.trim(), e.currentTarget));

document.getElementById("copyPasswordBtn").addEventListener("click", (e) =>
    copyText(document.getElementById("credPassword").value, e.currentTarget));

document.getElementById("copyBothBtn").addEventListener("click", (e) =>
    copyText(
        `Email: ${document.getElementById("credEmail").value.trim()}\n` +
        `Password: ${document.getElementById("credPassword").value}`,
        e.currentTarget));

// ============================================================
// REFRESH BUTTON
// ============================================================
document.getElementById("refreshBtn").addEventListener("click", loadCompanies);

// ============================================================
// BOOT
// ============================================================
(async function boot() {
    await loadPlans();
    await loadCompanies();
})();
