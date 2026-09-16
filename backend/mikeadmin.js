// ============================================================
// mikeadmin.js — Database health check + admin utilities
// ============================================================
// Run:  node mikeadmin.js
//
// What it does:
//   1. Confirms PostgreSQL is reachable
//   2. Lists your tables
//   3. Confirms the Super Admin row exists
//   4. Prints a summary
// ============================================================

const pool = require("./db");

async function runHealthCheck() {
    console.log("\n============================================");
    console.log("  RECEIPT SYSTEM — DATABASE HEALTH CHECK");
    console.log("============================================\n");

    // ------------------------------------------------------------
    // 1. Server time
    // ------------------------------------------------------------
    try {
        const timeRes = await pool.query("SELECT NOW() AS now");
        console.log(`✅ Database reachable  →  ${timeRes.rows[0].now}`);
    } catch (err) {
        console.error("❌ Cannot reach database:", err.message);
        console.error("   → Check .env, and that PostgreSQL service is running.");
        process.exit(1);
    }

    // ------------------------------------------------------------
    // 2. Table count
    // ------------------------------------------------------------
    try {
        const tablesRes = await pool.query(`
            SELECT tablename
            FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename
        `);
        console.log(`\n📦 Tables found: ${tablesRes.rows.length}`);
        tablesRes.rows.forEach((r, i) => {
            console.log(`   ${String(i + 1).padStart(2, " ")}. ${r.tablename}`);
        });
    } catch (err) {
        console.error("❌ Failed to list tables:", err.message);
    }

    // ------------------------------------------------------------
    // 3. Plans seeded?
    // ------------------------------------------------------------
    try {
        const plansRes = await pool.query("SELECT code, name, price FROM plans ORDER BY id");
        console.log(`\n💳 Plans: ${plansRes.rows.length}`);
        plansRes.rows.forEach((p) => {
            console.log(`   • ${p.code.padEnd(10)} → ${p.name} (₦${p.price})`);
        });
    } catch (err) {
        console.error("❌ Failed to read plans:", err.message);
    }

    // ------------------------------------------------------------
    // 4. Receipt types seeded?
    // ------------------------------------------------------------
    try {
        const rtRes = await pool.query("SELECT COUNT(*)::int AS n FROM receipt_types");
        console.log(`\n🧾 Receipt types: ${rtRes.rows[0].n}`);
    } catch (err) {
        console.error("❌ Failed to count receipt types:", err.message);
    }

    // ------------------------------------------------------------
    // 5. Super Admin exists?
    // ------------------------------------------------------------
    try {
        const adminRes = await pool.query(`
            SELECT id, full_name, email, role, is_active
            FROM users
            WHERE role = 'super_admin'
            ORDER BY id
        `);
        if (adminRes.rows.length === 0) {
            console.log("\n⚠️  No super_admin user found. Add one before starting the server.");
        } else {
            console.log(`\n👤 Super Admin(s): ${adminRes.rows.length}`);
            adminRes.rows.forEach((u) => {
                console.log(`   • [${u.id}] ${u.full_name} <${u.email}> active=${u.is_active}`);
            });
        }
    } catch (err) {
        console.error("❌ Failed to read users:", err.message);
    }

    console.log("\n============================================");
    console.log("  ✅ HEALTH CHECK COMPLETE");
    console.log("============================================\n");

    await pool.end();
}

runHealthCheck().catch((err) => {
    console.error("Fatal error during health check:", err);
    process.exit(1);
});