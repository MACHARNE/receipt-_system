// ============================================================
// server.js — Main Express application
// ============================================================
// Run:  node server.js   (or  npm start  if you set up package.json)
//
// Responsibilities:
//   1. Start the HTTP server
//   2. Parse JSON and form bodies
//   3. Manage sessions (stored in PostgreSQL)
//   4. Serve the static frontend
//   5. Mount API routes
//   6. Provide health endpoints
// ============================================================

const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const cors = require("cors");
const path = require("path");

// Load .env FIRST — before anything reads process.env
require("dotenv").config({ path: path.join(__dirname, ".env") });

// Shared DB pool
const pool = require("./db");

// ------------------------------------------------------------
// CREATE APP
// ------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// TRUST PROXY
// ------------------------------------------------------------
// Behind Nginx/Caddy the real client address arrives in X-Forwarded-For, and
// rate limiting keys on req.ip. Enable this ONLY when the app really is behind
// a proxy: otherwise a client could spoof that header and sidestep the limits.
if (process.env.TRUST_PROXY === "true") {
    app.set("trust proxy", 1);
}

// ------------------------------------------------------------
// GLOBAL MIDDLEWARE (runs on every request, in this order)
// ------------------------------------------------------------

// 1. CORS — allow browser to call the API with credentials (cookies)
app.use(cors({
    origin: true,          // reflect request origin
    credentials: true,     // allow cookies
}));

// 2. Body parsers
app.use(express.json({ limit: "5mb" }));                    // JSON bodies
app.use(express.urlencoded({ extended: true, limit: "5mb" })); // form bodies

// 3. Sessions — stored in PostgreSQL so they survive restarts
app.use(session({
    store: new PgSession({
        pool: pool,
        tableName: "session",     // matches the table we created
    }),
    name: "receipt.sid",           // cookie name (not the default "connect.sid")
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,                          // JS cannot read the cookie
        secure: process.env.NODE_ENV === "production", // HTTPS only in prod
        sameSite: "lax",                         // CSRF mitigation
        maxAge: 1000 * 60 * 60 * 24 * 7,         // 7 days
    },
}));

// ------------------------------------------------------------
// STATIC FRONTEND
// ------------------------------------------------------------
const frontendPath = path.join(__dirname, "..", "frontend");
app.use(express.static(frontendPath));
// Serve uploaded files (logos, later imports, etc.)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ------------------------------------------------------------
// HEALTH ENDPOINTS
// ------------------------------------------------------------

// Simple liveness check — no DB access
app.get("/health", (req, res) => {
    res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date() });
});

// Deep check — hits the DB
app.get("/test-db", async (req, res) => {
    try {
        const result = await pool.query("SELECT NOW() AS now, current_database() AS db");
        res.json({
            message: "Database reachable",
            database: result.rows[0].db,
            serverTime: result.rows[0].now,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Database unreachable", error: err.message });
    }
});

// ------------------------------------------------------------
// ROUTES (we'll add more as we build)
// ------------------------------------------------------------
app.use("/auth", require("./routes/auth"));
app.use("/superadmin", require("./routes/superadmin"));
app.use("/company", require("./routes/company"));
app.use("/categories", require("./routes/categories"));
app.use("/items", require("./routes/items"));
app.use("/customers", require("./routes/customers"));
app.use("/reports", require("./routes/reports"));
app.use("/users", require("./routes/users"));
app.use("/receipt-config", require("./routes/receiptConfig"));
app.use("/receipts", require("./routes/receipts"));
// Public: reached by scanning a QR code on a printed receipt, so it must not
// sit behind the session guard.
app.use("/verify", require("./routes/verify"));
// ...

// ------------------------------------------------------------
// 404 HANDLER — anything not matched above
// ------------------------------------------------------------
app.use((req, res) => {
    res.status(404).json({ message: "Route not found", path: req.originalUrl });
});

// ------------------------------------------------------------
// GLOBAL ERROR HANDLER — last middleware, 4 args
// ------------------------------------------------------------
app.use((err, req, res, next) => {
    console.error("Unhandled error:", err);
    res.status(err.status || 500).json({
        message: err.message || "Internal server error",
    });
});

// ------------------------------------------------------------
// START SERVER
// ------------------------------------------------------------
app.listen(PORT, () => {
    console.log("\n============================================");
    console.log(`  🚀 Server running on http://localhost:${PORT}`);
    console.log(`  📁 Serving frontend from: ${frontendPath}`);
    console.log(`  🌱 Environment: ${process.env.NODE_ENV || "development"}`);
    console.log("============================================\n");
});
