// ============================================================
// js/reports.js — Collection reports
// ============================================================
// Dates are handled as plain YYYY-MM-DD strings throughout, never as Date
// objects: constructing a Date from "2026-09-01" and reading it back in a
// negative-offset timezone yields 31 August, which would silently shift a whole
// month's report.
// ============================================================

const navUser = document.getElementById("navUser");
const pageAlert = document.getElementById("pageAlert");

let currentRange = { from: null, to: null };
let currency = "";

// ---------- Helpers ----------
function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}

function money(value) {
    return Number(value || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
}

function amount(value) {
    return currency ? `${money(value)} ${currency}` : money(value);
}

function showAlert(message, type = "danger") {
    pageAlert.className = `alert alert-${type}`;
    pageAlert.textContent = message;
    pageAlert.classList.remove("d-none");
}
function clearAlert() {
    pageAlert.classList.add("d-none");
}

function isoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function presetRange(preset) {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    if (preset === "today") return { from: isoDate(today), to: isoDate(today) };
    if (preset === "week") {
        // Week runs Monday to Sunday.
        const weekday = (today.getDay() + 6) % 7;
        const monday = new Date(today);
        monday.setDate(today.getDate() - weekday);
        return { from: isoDate(monday), to: isoDate(today) };
    }
    if (preset === "lastmonth") {
        const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const last = new Date(today.getFullYear(), today.getMonth(), 0);
        return { from: isoDate(first), to: isoDate(last) };
    }
    return { from: isoDate(startOfMonth), to: isoDate(today) };
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
        // §7.4: staff issue receipts but do not see the collection figures.
        if (currentUser.role !== "owner" && currentUser.role !== "admin") {
            window.location.href = "/dashboard.html";
            return;
        }
        navUser.textContent = currentUser.full_name || "";
    } catch {
        window.location.href = "/index.html";
        return;
    }

    applyPreset("month");
})();

document.getElementById("logoutBtn").addEventListener("click", async () => {
    try { await api.post("/auth/logout"); } catch {}
    window.location.href = "/index.html";
});

// ---------- Period controls ----------
function applyPreset(preset) {
    const range = presetRange(preset);
    document.getElementById("fromDate").value = range.from;
    document.getElementById("toDate").value = range.to;

    document.querySelectorAll("#presetGroup button").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.preset === preset);
    });

    load(range.from, range.to);
}

document.querySelectorAll("#presetGroup button").forEach(btn => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
});

document.getElementById("applyBtn").addEventListener("click", () => {
    // A hand-picked range no longer matches a preset.
    document.querySelectorAll("#presetGroup button").forEach(btn => btn.classList.remove("active"));
    load(document.getElementById("fromDate").value, document.getElementById("toDate").value);
});

// ---------- Load ----------
async function load(from, to) {
    clearAlert();
    if (!from || !to) {
        showAlert("Choose both a start and an end date.");
        return;
    }

    try {
        const query = new URLSearchParams({ from, to }).toString();
        const data = await api.get(`/reports/summary?${query}`);

        currentRange = { from: data.range.from, to: data.range.to };
        currency = data.currency || "";

        render(data);
    } catch (err) {
        if (err.status === 403) {
            window.location.href = "/dashboard.html";
            return;
        }
        showAlert(err.message || "Could not load that report.");
    }
}

function render(data) {
    const { totals, range } = data;

    document.getElementById("rangeLine").textContent =
        `${range.from} to ${range.to}${currency ? ` · amounts in ${currency}` : ""}`;

    document.getElementById("statReceipts").textContent = totals.receipts;
    document.getElementById("statVoided").textContent =
        totals.voided > 0 ? `${totals.voided} voided (excluded)` : "none voided";
    document.getElementById("statBilled").textContent = amount(totals.billed);
    document.getElementById("statCollected").textContent = amount(totals.collected);
    document.getElementById("statOutstanding").textContent = amount(totals.outstanding);
    document.getElementById("statDiscounts").textContent =
        Number(totals.discounts) > 0 ? `Discounts ${amount(totals.discounts)}` : "no discounts";

    // Export follows whatever period is on screen.
    document.getElementById("exportBtn").href =
        `/reports/receipts.csv?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;

    const empty = (cols, message) =>
        `<tr><td colspan="${cols}" class="text-muted text-center py-3">${escapeHtml(message)}</td></tr>`;

    document.getElementById("dailyBody").innerHTML = data.daily.length
        ? data.daily.map(row => `
            <tr>
              <td>${escapeHtml(String(row.day).slice(0, 10))}</td>
              <td class="text-end">${row.receipts}</td>
              <td class="text-end fw-semibold">${amount(row.collected)}</td>
            </tr>`).join("")
        : empty(3, "No receipts in this period.");

    document.getElementById("typeBody").innerHTML = data.by_type.length
        ? data.by_type.map(row => `
            <tr>
              <td>${escapeHtml(row.name)}</td>
              <td class="text-end">${row.receipts}</td>
              <td class="text-end fw-semibold">${amount(row.collected)}</td>
              <td class="text-end ${Number(row.outstanding) > 0 ? "text-danger" : "text-muted"}">${amount(row.outstanding)}</td>
            </tr>`).join("")
        : empty(4, "No receipts in this period.");

    document.getElementById("methodBody").innerHTML = data.by_method.length
        ? data.by_method.map(row => `
            <tr>
              <td>${escapeHtml(row.method.charAt(0).toUpperCase() + row.method.slice(1))}</td>
              <td class="text-end">${row.receipts}</td>
              <td class="text-end fw-semibold">${amount(row.collected)}</td>
            </tr>`).join("")
        : empty(3, "No payments recorded.");

    document.getElementById("staffBody").innerHTML = data.by_staff.length
        ? data.by_staff.map(row => `
            <tr>
              <td>${escapeHtml(row.staff)}</td>
              <td class="text-end">${row.receipts}</td>
              <td class="text-end fw-semibold">${amount(row.collected)}</td>
            </tr>`).join("")
        : empty(3, "No receipts in this period.");

    // A status breakdown is only interesting when something is not simply paid.
    const noteworthy = data.by_status.filter(row => row.status !== "paid");
    if (noteworthy.length) {
        const extra = noteworthy
            .map(row => `${row.receipts} ${String(row.status).toUpperCase()}`)
            .join(" · ");
        document.getElementById("statVoided").textContent =
            `${totals.voided > 0 ? `${totals.voided} voided (excluded) · ` : ""}${extra}`;
    }
}
