// ============================================================
// js/settings.js — Business profile (read-only)
// ============================================================
// Company identity is managed by the platform administrator, so this page shows
// what will be printed on a receipt rather than offering fields to edit. It is
// the one place a company user can check exactly what their customers will see.
// ============================================================

const navUser = document.getElementById("navUser");
const pageAlert = document.getElementById("pageAlert");

function showAlert(message, type = "danger") {
    pageAlert.className = `alert alert-${type}`;
    pageAlert.textContent = message;
    pageAlert.classList.remove("d-none");
}

function text(id, value) {
    document.getElementById(id).textContent = value || "—";
}

// ---------- Auth ----------
let currentUser = null;
(async function boot() {
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
        return;
    }

    await load();
})();

document.getElementById("logoutBtn").addEventListener("click", async () => {
    try { await api.post("/auth/logout"); } catch {}
    window.location.href = "/index.html";
});

// ---------- Load ----------
async function load() {
    try {
        const { company } = await api.get("/company/settings");

        text("cName", company.name);
        text("cAbbr", company.abbreviation);
        text("cAddress", company.address);
        text("cPhone", company.phone);
        text("cEmail", company.email);
        text("cWebsite", company.website);
        text("cTin", company.tin);
        text("cCac", company.cac_number);
        text("cCurrency", company.default_currency);
        text("cFooter", company.receipt_footer);

        const position = company.header_position;
        text("cHeaderPosition", position ? position.charAt(0).toUpperCase() + position.slice(1) : null);

        text("cWatermark", company.use_logo_watermark ? "On" : "Off");

        if (company.logo_path) {
            const logo = document.getElementById("logoPreview");
            logo.src = `/company/logo?t=${Date.now()}`;
            logo.classList.remove("d-none");
            document.getElementById("logoEmpty").classList.add("d-none");
        }
    } catch (err) {
        showAlert(err.message || "Could not load your business profile.");
    }
}
