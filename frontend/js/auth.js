// ============================================================
// js/auth.js — Login page logic
// ============================================================

const alertBox    = document.getElementById("alertBox");
const loginForm   = document.getElementById("loginForm");
const loginBtn    = document.getElementById("loginBtn");
const emailInput  = document.getElementById("loginEmail");
const passInput   = document.getElementById("loginPassword");
const toggleBtn   = document.getElementById("togglePassword");
const toggleIcon  = document.getElementById("toggleIcon");

// ------------------------------------------------------------
// Alert helper
// ------------------------------------------------------------
function showAlert(message, type = "danger") {
    alertBox.className = `alert alert-${type} mt-3 mb-0`;
    alertBox.textContent = message;
    alertBox.classList.remove("d-none");
}
function hideAlert() {
    alertBox.classList.add("d-none");
}

// ------------------------------------------------------------
// Show / hide password
// ------------------------------------------------------------
toggleBtn.addEventListener("click", () => {
    const showing = passInput.type === "text";
    passInput.type = showing ? "password" : "text";
    toggleIcon.className = showing ? "bi bi-eye" : "bi bi-eye-slash";
});

// ------------------------------------------------------------
// If already logged in, skip the login page
// ------------------------------------------------------------
(async function redirectIfLoggedIn() {
    try {
        const data = await api.get("/auth/me");
        redirectByRole(data.user.role);
    } catch {
        // Not logged in — stay on this page
    }
})();

// ------------------------------------------------------------
// Submit handler
// ------------------------------------------------------------
loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAlert();

    const email    = emailInput.value.trim();
    const password = passInput.value;

    if (!email || !password) {
        showAlert("Please enter both email and password.");
        return;
    }

    loginBtn.disabled = true;
    loginBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Signing in…`;

    try {
        const data = await api.post("/auth/login", { email, password });
        // Success — go where the server told us
        window.location.href = data.redirect || "/dashboard.html";
    } catch (err) {
        showAlert(err.message || "Login failed.");
        loginBtn.disabled = false;
        loginBtn.textContent = "Sign In";
    }
});

// ------------------------------------------------------------
// Role-based redirect
// ------------------------------------------------------------
function redirectByRole(role) {
    if (role === "super_admin") {
        window.location.href = "/superadmin-dashboard.html";
    } else {
        window.location.href = "/dashboard.html";
    }
}
