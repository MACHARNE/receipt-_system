const router = require('express').Router();
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const pool = require('../db');
const upload = require('../middleware/upload');
const { requireCompanyUser } = require('../middleware/auth');
const logoDirectory = path.join(__dirname, '..', 'uploads', 'logos');
router.use(requireCompanyUser);
const canEdit = (req, res) => res.status(403).json({
    message: 'Company identity is managed by the platform administrator. Please contact support to request a change.',
});
const fields = { name: 150, abbreviation: 10, address: 2000, phone: 30, email: 120,
    website: 150, tin: 50, cac_number: 50, default_currency: 3, receipt_footer: 2000, header_position: 10 };

router.get('/settings', async (req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT * FROM companies WHERE id = $1', [req.user.company_id]);
        if (!rows[0]) return res.status(404).json({ message: 'Company not found.' });
        res.json({ company: rows[0], canEdit: ['owner', 'admin'].includes(req.user.role) });
    } catch (err) { next(err); }
});

router.put('/settings', canEdit, async (req, res, next) => {
    const values = [], assignments = [];
    for (const [key, limit] of Object.entries(fields)) {
        if (!Object.hasOwn(req.body || {}, key)) continue;
        if (typeof req.body[key] !== 'string' || req.body[key].trim().length > limit) {
            return res.status(400).json({ message: 'Invalid value for ' + key + '.' });
        }
        let value = req.body[key].trim();
        if (key === 'name' && !value) return res.status(400).json({ message: 'Company name is required.' });
        if (key === 'default_currency') {
            value = value.toUpperCase();
            if (!/^[A-Z]{3}$/.test(value)) return res.status(400).json({ message: 'Use a three-letter currency code.' });
        }
        if (key === 'header_position' && !['left', 'center', 'right'].includes(value)) return res.status(400).json({ message: 'Invalid header position.' });
        if (key === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return res.status(400).json({ message: 'Enter a valid email.' });
        if (key === 'website' && value) {
            try { if (!['http:', 'https:'].includes(new URL(value).protocol)) throw new Error(); }
            catch { return res.status(400).json({ message: 'Website must be an http or https URL.' }); }
        }
        values.push(value || null);
        assignments.push(key + ' = $' + values.length);
    }
    if (Object.hasOwn(req.body || {}, 'use_logo_watermark')) {
        if (typeof req.body.use_logo_watermark !== 'boolean') return res.status(400).json({ message: 'Watermark must be true or false.' });
        values.push(req.body.use_logo_watermark);
        assignments.push('use_logo_watermark = $' + values.length);
    }
    if (!assignments.length) return res.status(400).json({ message: 'No settings supplied.' });
    values.push(req.user.company_id);
    try {
        const { rows } = await pool.query('UPDATE companies SET ' + assignments.join(', ') + ', updated_at = NOW() WHERE id = $' + values.length + ' RETURNING *', values);
        if (!rows[0]) return res.status(404).json({ message: 'Company not found.' });
        res.json({ message: 'Settings saved.', company: rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: 'That abbreviation is already in use.' });
        next(err);
    }
});

router.post('/logo', canEdit, upload.single('logo'), async (req, res, next) => {
    if (!req.file) return res.status(400).json({ message: 'Choose a logo to upload.' });
    const buffer = req.file.buffer;
    let extension;
    if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) extension = 'png';
    else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) extension = 'jpg';
    else if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') extension = 'webp';
    if (!extension) return res.status(400).json({ message: 'The file is not a supported image.' });
    const filename = req.user.company_id + '-' + randomUUID() + '.' + extension;
    const destination = path.join(logoDirectory, filename);
    try {
        await fs.mkdir(logoDirectory, { recursive: true });
        await fs.writeFile(destination, buffer, { flag: 'wx' });
        const { rows } = await pool.query('UPDATE companies SET logo_path = $1, updated_at = NOW() WHERE id = $2 RETURNING id', [filename, req.user.company_id]);
        if (!rows[0]) throw new Error('Company not found.');
        res.json({ message: 'Logo uploaded.', logo_url: '/company/logo' });
    } catch (err) {
        await fs.unlink(destination).catch(() => {});
        next(err);
    }
});

router.get('/logo', async (req, res, next) => {
    try {
        const { rows } = await pool.query('SELECT logo_path FROM companies WHERE id = $1', [req.user.company_id]);
        const filename = rows[0]?.logo_path;
        if (!filename || filename !== path.basename(filename)) return res.status(404).json({ message: 'No logo uploaded.' });
        res.set('Cache-Control', 'private, no-store');
        res.set('X-Content-Type-Options', 'nosniff');
        res.sendFile(filename, { root: logoDirectory, dotfiles: 'deny' }, err => { if (err) next(err); });
    } catch (err) { next(err); }
});
router.use((err, req, res, next) => {
    if (err.name === 'MulterError') return res.status(400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'Logo must be 2 MB or smaller.' : 'Upload one image in the logo field.' });
    next(err);
});
module.exports = router;
