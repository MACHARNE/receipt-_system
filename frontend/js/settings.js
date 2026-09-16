// ============================================================
// js/settings.js — Company settings page
// ============================================================

// ---------- Element refs ----------
const form          = document.getElementById("settingsForm");
const pageAlert     = document.getElementById("pageAlert");
const saveBtn       = document.getElementById("saveBtn");
const resetBtn      = document.getElementById("resetBtn");
const navUser       = document.getElementById("navUser");
const toastContainer = document.getElementById("toastContainer");

const logoFileInput  = document.getElementById("logoFile");
const logoPreview    = document.getElementById("logoPreview");
const logoPlaceholder= document.getElementById("logoPlaceholder");
const removeLogoBtn  = document.getElementById("removeLogoBtn");

// ---------- Snapshot for "Reset" ----------
let originalCompany = null;

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
    new bootstrap.Toast(el, { delay: 3500 }).show();
    el.addEventListener("hidden.bs.toast", () => el.remove());
}

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function showAlert(msg, type = "danger") {
    pageAlert.className = `alert alert-${type}`;
    pageAlert.textContent = msg;
    pageAlert.classList.remove("d-none");
}
function hideAlert() {
    pageAlert.classList.add("d-none");
}

// ---------- Auth guard ----------
(async function guard() {
    try {
        const me = await api.get("/auth/me");
        if (me.role === "super_admin") {
            window.location.href = "/superadmin-dashboard.html";
            return;
        }
        // Staff cannot edit settings
        if (me.role === "staff") {
            showAlert("You do not have permission to view this page.", "warning");
            form.querySelectorAll("input, select, textarea, button").forEach(el => el.disabled = true);
            document.getElementById("saveBtn").disabled = true;
        }
        navUser.textContent = me.fullName || "";
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
// LOAD COMPANY
// ============================================================
async function loadCompany() {
    try {
        const { company } = await api.get("/company/me");
        originalCompany = { ...company };
        fillForm(company);
    } catch (err) {
        showAlert(err.message || "Failed to load company data.");
    }
}

function fillForm(c) {
    document.getElementById("sName").value     = c.name || "";
    document.getElementById("sAbbr").value     = c.abbreviation || "";
    document.getElementById("sEmail").value    = c.email || "";
    document.getElementById("sPhone").value    = c.phone || "";
    document.getElementById("sWebsite").value  = c.website || "";
    document.getElementById("sAddress").value  = c.address || "";
    document.getElementById("sTin").value      = c.tin || "";
    document.getElementById("sCac").value      = c.cac_number || "";
    document.getElementById("sFooter").value   = c.receipt_footer || "";
    document.getElementById("sCurrency").value = c.default_currency || "NGN";
    document.getElementById("sWatermark").checked = !!c.use_logo_watermark;

    // Header position radio
    const hp = c.header_position || "left";
    const radio = document.querySelector(`input[name="header_position"][value="${hp}"]`);
    if (radio) radio.checked = true;

    // Logo
    if (c.logo_path) {
        logoPreview.src = c.logo_path;
        logoPreview.style.display = "block";
        logoPlaceholder.style.display = "none";
        removeLogoBtn.classList.remove("d-none");
    } else {
        logoPreview.style.display = "none";
        logoPlaceholder.style.display = "block";
        removeLogoBtn.classList.add("d-none");
    }
}

// ============================================================
// RESET
// ============================================================
resetBtn.addEventListener("click", () => {
    if (!originalCompany) return;
    fillForm(originalCompany);
    hideAlert();
    toast("Form reset to last saved values.", "secondary");
});

// ============================================================
// SAVE
// ============================================================
form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAlert();

    const headerRadio = document.querySelector('input[name="header_position"]:checked');

    const payload = {
        name:     document.getElementById("sName").value.trim(),
        abbreviation: document.getElementById("sAbbr").value.trim() || null,
        email:    document.getElementById("sEmail").value.trim() || null,
        phone:    document.getElementById("sPhone").value.trim() || null,
        website:  document.getElementById("sWebsite").value.trim() || null,
        address:  document.getElementById("sAddress").value.trim() || null,
        tin:      document.getElementById("sTin").value.trim() || null,
        cac_number: document.getElementById("sCac").value.trim() || null,
        receipt_footer: document.getElementById("sFooter").value.trim() || null,
        default_currency: document.getElementById("sCurrency").value,
        header_position: headerRadio ? headerRadio.value : "left",
        use_logo_watermark: document.getElementById("sWatermark").checked,
    };

    if (!payload.name) {
        showAlert("Company name is required.");
        return;
    }

    saveBtn.disabled = true;
    const orig = saveBtn.innerHTML;
    saveBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving…`;

    try {
        const { company } = await api.put("/company/me", payload);
        originalCompany = { ...company };
        fillForm(company);
        toast("Company settings saved.", "success");
    } catch (err) {
        showAlert(err.message || "Failed to save settings.");
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = orig;
    }
});

// ============================================================
// LOGO UPLOAD
// ============================================================
logoFileInput.addEventListener("change", async () => {
    const file = logoFileInput.files[0];
    if (!file) return;

    // Client-side guard
    if (file.size > 2 * 1024 * 1024) {
        showAlert("Logo must be smaller than 2 MB.");
        logoFileInput.value = "";
        return;
    }

    const formData = new FormData();
    formData.append("logo", file);

    try {
        const res = await fetch("/company/me/logo", {
            method: "POST",
            credentials: "include",
            body: formData,   // no Content-Type — browser sets multipart boundary
        });
        const data = await res.json();
        if (!res.ok) throw data;

        logoPreview.src = data.logo_path + "?t=" + Date.now();
        logoPreview.style.display = "block";
        logoPlaceholder.style.display = "none";
        removeLogoBtn.classList.remove("d-none");
        toast("Logo uploaded.", "success");
    } catch (err) {
        showAlert(err.message || "Failed to upload logo.");
    } finally {
        logoFileInput.value = "";
    }
});

// ============================================================
// REMOVE LOGO
// ============================================================
removeLogoBtn.addEventListener("click", async () => {
    if (!confirm("Remove the company logo?")) return;
    try {
        await api.del("/company/me/logo");
        logoPreview.src = "";
        logoPreview.style.display = "none";
        logoPlaceholder.style.display = "block";
        removeLogoBtn.classList.add("d-none");
        toast("Logo removed.", "success");
    } catch (err) {
        showAlert(err.message || "Failed to remove logo.");
    }
});

// ============================================================
// BOOT
// ============================================================
loadCompany();