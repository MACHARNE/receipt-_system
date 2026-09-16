// ============================================================
// utils/password.js — Secure password generation
// ============================================================
// Used when a Super Admin provisions a company owner or resets an
// owner's password. Generated passwords are handed to the company
// owner once, so they must be strong but also easy to read aloud
// or type by hand.
//
// Design notes:
//   - crypto.randomInt is a CSPRNG and avoids the modulo bias that
//     `randomBytes[i] % alphabet.length` introduces.
//   - Ambiguous look-alikes (0/O, 1/l/I) are excluded so a password
//     can be transcribed from a screen or read over the phone.
//   - At least one character from every group is guaranteed, then
//     the result is shuffled so the position carries no information.
// ============================================================

const crypto = require("node:crypto");

const GROUPS = [
    "abcdefghijkmnpqrstuvwxyz",      // no l, o
    "ABCDEFGHJKLMNPQRSTUVWXYZ",      // no I, O
    "23456789",                      // no 0, 1
    "!@#$%^&*-_=+",
];

const ALL_CHARACTERS = GROUPS.join("");

// Owner passwords must comfortably exceed the 8 character minimum
// while staying well under bcrypt's 72 byte limit.
const DEFAULT_LENGTH = 14;

/**
 * Generate a cryptographically secure random password.
 * @param {number} length total characters (minimum 8)
 * @returns {string}
 */
function generatePassword(length = DEFAULT_LENGTH) {
    const size = Math.max(8, Math.min(Number(length) || DEFAULT_LENGTH, 64));

    // One guaranteed character from each group first.
    const characters = GROUPS.map((group) => group[crypto.randomInt(group.length)]);

    while (characters.length < size) {
        characters.push(ALL_CHARACTERS[crypto.randomInt(ALL_CHARACTERS.length)]);
    }

    // Fisher-Yates shuffle using cryptographically secure indices.
    for (let i = characters.length - 1; i > 0; i -= 1) {
        const j = crypto.randomInt(i + 1);
        [characters[i], characters[j]] = [characters[j], characters[i]];
    }

    return characters.join("");
}

module.exports = { generatePassword, DEFAULT_LENGTH };
