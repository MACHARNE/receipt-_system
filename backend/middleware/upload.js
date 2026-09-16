const multer = require('multer');

// Keep uploads in memory until their contents have been validated.
module.exports = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 },
    fileFilter(req, file, callback) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
            return callback(Object.assign(new Error('Choose a PNG, JPEG or WebP image.'), { status: 400 }));
        }
        callback(null, true);
    },
});
