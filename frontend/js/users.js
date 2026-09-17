// ============================================================
// js/users.js — The company's team
// ============================================================
// Owner-only screen. Passwords are generated server-side and shown once; this
// page never receives one it did not just ask for.
// ============================================================

// ---------- State ----------
let users = [];
let editingId = null;

// ---------- Element refs ----------
const usersBody = document.getElementById("usersBody");
const navUser = document.getElementById("navUser");
const toastContainer = document.getElementById("toastContainer");

const userModal = new bootstrap.Modal("#userModal");
const passwordModal = new bootstrap.Modal("#passwordModal");

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

function fmtDateTime(value) {
    if (!value) return "Never";
    const d = new Date(value);
    return Number.isNaN(d.getTime())
        ? "—"
        : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const ROLE_BADGES = {
    owner: '<span class="badge bg-primary-subtle text-primary-emphasis">Owner</span>',
    admin: '<span class="badge bg-info-subtle text-info-emphasis">Administrator</span>',
    staff: '<span class="badge bg-secondary-subtle text-secondary-emphasis">Staff / Cashier</span>',
};

// ---------- Auth ----------
(async function boot() {
    try {
        const { user } = await api.get("/auth/me");
        if (user.role === "super_admin") {
            window.location.href = "/superadmin-dashboard.html";
            return;
        }
        navUser.textContent = user.full_name || "";

        // §7.3: an administrator cannot manage company users.
        if (user.role !== "owner") {
            document.querySelector("main").innerHTML = `
              <div class="alert alert-warning">
                <i class="bi bi-lock me-1"></i>
                Only the account owner can manage the team. Please ask them if you need a change here.
              </div>`;
            return;
        }
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
    usersBody.innerHTML = `
      <tr><td colspan="7" class="empty-state">
        <div class="spinner-border spinner-border-sm"></div>
        <div class="mt-2">Loading…</div>
      </td></tr>`;

    try {
        const data = await api.get("/users");
        users = data.users || [];
        render();
    } catch (err) {
        usersBody.innerHTML = `
          <tr><td colspan="7" class="empty-state text-danger">
            <i class="bi bi-exclamation-triangle"></i>
            ${escapeHtml(err.message || "Failed to load your team.")}
          </td></tr>`;
    }
}

function render() {
    const me = users.find(u => u.role === "owner") || null;

    usersBody.innerHTML = users.map((u, i) => {
        const isOwner = u.role === "owner";

        const actions = isOwner
            ? `<span class="small text-muted">Managed by the platform administrator</span>`
            : `<div class="btn-group btn-group-sm">
                 <button class="btn btn-outline-secondary" data-action="edit" data-id="${u.id}" title="Edit">
                   <i class="bi bi-pencil"></i>
                 </button>
                 <button class="btn btn-outline-secondary" data-action="password" data-id="${u.id}" title="New password">
                   <i class="bi bi-key"></i>
                 </button>
                 <button class="btn btn-outline-${u.is_active ? "danger" : "success"}"
                         data-action="toggle" data-id="${u.id}"
                         title="${u.is_active ? "Suspend" : "Allow sign-in"}">
                   <i class="bi bi-${u.is_active ? "pause-circle" : "play-circle"}"></i>
                 </button>
               </div>`;

        return `
          <tr>
            <td>${i + 1}</td>
            <td>
              <div class="fw-semibold">${escapeHtml(u.full_name)}</div>
              <div class="small text-muted d-md-none">${escapeHtml(u.email)}</div>
            </td>
            <td class="d-none d-md-table-cell">${escapeHtml(u.email)}</td>
            <td>${ROLE_BADGES[u.role] || escapeHtml(u.role)}</td>
            <td class="d-none d-lg-table-cell small text-muted">${escapeHtml(fmtDateTime(u.last_login_at))}</td>
            <td>
              ${u.is_active
                  ? '<span class="badge bg-success-subtle text-success-emphasis">Active</span>'
                  : '<span class="badge bg-warning-subtle text-warning-emphasis">Suspended</span>'}
            </td>
            <td class="text-end">${actions}</td>
          </tr>`;
    }).join("");

    if (users.length === 0) {
        usersBody.innerHTML = `
          <tr><td colspan="7" class="empty-state">
            <i class="bi bi-people"></i>
            <div>No team members yet</div>
            <div class="small">Add the people who will issue receipts.</div>
          </td></tr>`;
    }
}

// ---------- Add / edit ----------
function openUserModal(user) {
    clearAlert("userAlert");
    document.getElementById("userForm").reset();
    editingId = user ? user.id : null;

    document.getElementById("userModalTitle").textContent = user ? "Edit Team Member" : "Add Team Member";
    document.getElementById("uName").value = user?.full_name || "";
    document.getElementById("uEmail").value = user?.email || "";
    document.getElementById("uPhone").value = user?.phone || "";
    document.getElementById("uRole").value = user?.role === "admin" ? "admin" : "staff";
    document.getElementById("uActive").checked = user ? user.is_active !== false : true;

    // The email is the sign-in identity; the API does not allow changing it.
    const emailInput = document.getElementById("uEmail");
    emailInput.readOnly = Boolean(user);
    document.getElementById("emailHint").textContent = user
        ? "A sign-in address cannot be changed. Add a new account instead."
        : "They sign in with this address.";

    // Password is only set at creation, or through the key button afterwards.
    document.getElementById("passwordBlock").classList.toggle("d-none", Boolean(user));

    userModal.show();
}

document.getElementById("newUserBtn").addEventListener("click", () => openUserModal(null));

document.getElementById("toggleUPass").addEventListener("click", () => {
    const input = document.getElementById("uPassword");
    const icon = document.getElementById("toggleUPassIcon");
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    icon.className = showing ? "bi bi-eye" : "bi bi-eye-slash";
});

usersBody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const id = parseInt(btn.dataset.id, 10);
    const member = users.find(u => u.id === id);
    if (!member) return;

    if (btn.dataset.action === "edit") {
        openUserModal(member);
    }

    if (btn.dataset.action === "toggle") {
        const next = !member.is_active;
        const verb = next ? "allow" : "suspend";
        if (!confirm(`${verb.charAt(0).toUpperCase() + verb.slice(1)} sign-in for ${member.full_name}?`)) return;
        try {
            await api.put(`/users/${id}`, {
                full_name: member.full_name,
                phone: member.phone,
                role: member.role,
                is_active: next,
            });
            toast(next ? "They can sign in again." : "Sign-in suspended.", "success");
            await load();
        } catch (err) {
            toast(err.message || "Failed to update that account.", "danger");
        }
    }

    if (btn.dataset.action === "password") {
        if (!confirm(`Generate a new password for ${member.full_name}? Their current one stops working immediately.`)) return;
        try {
            const data = await api.post(`/users/${id}/reset-password`, {});
            if (data.password) {
                showCredentials({ name: member.full_name, email: member.email, password: data.password });
            } else {
                toast("Password updated.", "success");
            }
        } catch (err) {
            toast(err.message || "Failed to reset that password.", "danger");
        }
    }
});

document.getElementById("userForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAlert("userAlert");

    const name = document.getElementById("uName").value.trim();
    if (!name) return setAlert("userAlert", "A full name is required.");

    const btn = document.getElementById("userSubmitBtn");
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving…`;

    try {
        if (editingId) {
            await api.put(`/users/${editingId}`, {
                full_name: name,
                phone: document.getElementById("uPhone").value.trim(),
                role: document.getElementById("uRole").value,
                is_active: document.getElementById("uActive").checked,
            });
            userModal.hide();
            toast("Team member updated.", "success");
        } else {
            const data = await api.post("/users", {
                full_name: name,
                email: document.getElementById("uEmail").value.trim(),
                phone: document.getElementById("uPhone").value.trim(),
                role: document.getElementById("uRole").value,
                // Blank means "generate one for me".
                password: document.getElementById("uPassword").value,
            });
            userModal.hide();
            toast("Team member added.", "success");

            if (data.password) {
                showCredentials({ name: data.user.full_name, email: data.user.email, password: data.password });
            }
        }
        await load();
    } catch (err) {
        setAlert("userAlert", err.message || "Could not save that team member.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
    }
});

// ---------- One-time credentials ----------
function showCredentials({ name, email, password }) {
    document.getElementById("credName").textContent = name || "—";
    document.getElementById("credEmail").value = email || "";
    document.getElementById("credPassword").value = password || "";
    passwordModal.show();
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
