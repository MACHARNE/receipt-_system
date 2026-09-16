const pool = require('../db');

async function requireLogin(req, res, next) {
    if (!req.session?.userId) return res.status(401).json({ message: 'Please log in.' });
    try {
        const { rows } = await pool.query(
            `SELECT u.id, u.company_id, u.full_name, u.email, u.role,
                    u.is_active, c.is_active AS company_active
             FROM users u LEFT JOIN companies c ON c.id = u.company_id
             WHERE u.id = $1`, [req.session.userId]);
        const user = rows[0];
        if (!user || !user.is_active ||
            (user.role !== 'super_admin' && (!user.company_id || !user.company_active))) {
            return res.status(401).json({ message: 'Account unavailable. Please contact your administrator.' });
        }
        req.user = { id: user.id, company_id: user.company_id, full_name: user.full_name,
            email: user.email, role: user.role };
        next();
    } catch (err) { next(err); }
}

function allowRoles(roles) {
    return (req, res, next) => requireLogin(req, res, () => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'You do not have permission to access this resource.' });
        }
        next();
    });
}

module.exports = {
    requireLogin,
    requireRole: (...roles) => allowRoles(roles),
    requireSuperAdmin: allowRoles(['super_admin']),
    requireCompanyUser: allowRoles(['owner', 'admin', 'staff']),
};
