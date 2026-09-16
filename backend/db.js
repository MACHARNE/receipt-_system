// ============================================================
// db.js — PostgreSQL connection pool
// ============================================================
// This file creates ONE shared connection pool that every route
// will reuse. Never create a new Pool per request — that would
// exhaust DB connections under load.
// ============================================================

const { Pool } = require("pg");
const path = require("path");

// Load .env from the same folder as this file
require("dotenv").config({ path: path.join(__dirname, ".env") });

// ------------------------------------------------------------
// Create the pool
// ------------------------------------------------------------
const pool = new Pool({
    user:     process.env.DB_USER,
    host:     process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port:     parseInt(process.env.DB_PORT, 10),

    // Pool sizing — fine for development
    max: 10,                       // max simultaneous clients
    idleTimeoutMillis: 30000,      // close idle clients after 30s
    connectionTimeoutMillis: 5000, // fail fast if DB unreachable
});

// ------------------------------------------------------------
// Log pool-level errors so crashes don't go unnoticed
// ------------------------------------------------------------
pool.on("error", (err) => {
    console.error("Unexpected PostgreSQL pool error:", err);
    process.exit(-1);
});

// ------------------------------------------------------------
// Quick self-test on startup (only in development)
// ------------------------------------------------------------
if (process.env.NODE_ENV !== "production") {
    pool.query("SELECT NOW() AS now")
        .then((res) => {
            console.log(`✅ PostgreSQL connected — server time: ${res.rows[0].now}`);
        })
        .catch((err) => {
            console.error("❌ PostgreSQL connection failed:", err.message);
            console.error("   Check your .env values and that PostgreSQL is running.");
        });
}

module.exports = pool;