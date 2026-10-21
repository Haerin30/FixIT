const { randomBytes, createHash } = require('node:crypto');
const bcrypt = require('bcryptjs');
const hashToken = token => createHash('sha256').update(token).digest('hex');
const invalid = () => Object.assign(new Error('This reset link is invalid or expired. Please request a new link.'), { status: 400 });
const validPassword = password => typeof password === 'string' && [...password].length >= 8 && Buffer.byteLength(password, 'utf8') <= 72;

function passwordResetService(db, sendMail, now = () => new Date()) {
  return {
    async issue(email) {
      const user = await db.user.findUnique({ where: { email }, select: { id: true, email: true } });
      if (!user) return;
      const token = randomBytes(32).toString('hex');
      const tokenHash = hashToken(token);
      await db.$transaction(async tx => {
        // Serialize issuance and redemption for this account, including distinct tokens.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
        await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(now().getTime() + 30 * 60 * 1000) } });
      });
      try { await sendMail(user.email, token); }
      catch {
        await db.passwordResetToken.updateMany({ where: { tokenHash, usedAt: null }, data: { usedAt: now() } });
        throw new Error('RESET_MAIL_FAILED');
      }
    },
    async redeem(token, password, confirmPassword) {
      if (!validPassword(password)) throw Object.assign(new Error('Password must have at least 8 characters and no more than 72 UTF-8 bytes.'), { status: 400 });
      if (confirmPassword !== undefined && password !== confirmPassword) throw Object.assign(new Error('Passwords do not match.'), { status: 400 });
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw invalid();
      const tokenHash = hashToken(token);
      const candidate = await db.passwordResetToken.findUnique({ where: { tokenHash } });
      if (!candidate || candidate.usedAt || candidate.expiresAt <= now()) throw invalid();
      const passwordHash = await bcrypt.hash(password, 12);
      await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.userId}::uuid FOR UPDATE`;
        const time = now();
        const claimed = await tx.passwordResetToken.updateMany({ where: { tokenHash, usedAt: null, expiresAt: { gt: time } }, data: { usedAt: time } });
        if (claimed.count !== 1) throw invalid();
        await tx.user.update({ where: { id: candidate.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
        await tx.passwordResetToken.updateMany({ where: { userId: candidate.userId, usedAt: null }, data: { usedAt: time } });
      });
    },
  };
}

// PostgreSQL atomic counters are shared across workers and survive restarts.
async function takeLimit(db, scope, value, limit) {
  const key = hashToken(`${scope}:${value}`);
  const rows = await db.$queryRaw`
    INSERT INTO "PasswordResetRateLimit" ("key", "count", "expiresAt")
    VALUES (${key}, 1, CURRENT_TIMESTAMP + INTERVAL '15 minutes')
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "PasswordResetRateLimit"."expiresAt" <= CURRENT_TIMESTAMP THEN 1 ELSE "PasswordResetRateLimit"."count" + 1 END,
      "expiresAt" = CASE WHEN "PasswordResetRateLimit"."expiresAt" <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes' ELSE "PasswordResetRateLimit"."expiresAt" END
    RETURNING "count"`;
  return rows[0].count <= limit;
}
module.exports = { passwordResetService, hashToken, validPassword, takeLimit };
