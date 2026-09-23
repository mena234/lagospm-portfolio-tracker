import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const PASSWORD_ITERATIONS = 310_000;
const PASSWORD_BYTES = 32;

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function passwordProblems(password, context = {}) {
  const value = String(password ?? '');
  const lower = value.toLowerCase();
  const identifiers = [context.email, context.userId, context.displayName]
    .filter(Boolean)
    .flatMap((item) => String(item).toLowerCase().split(/[^a-z0-9]+/))
    .filter((item) => item.length >= 4);
  const problems = [];
  if (value.length < 12) problems.push('Use at least 12 characters.');
  if (value.length > 128) problems.push('Use no more than 128 characters.');
  if (!/[a-z]/.test(value)) problems.push('Add a lowercase letter.');
  if (!/[A-Z]/.test(value)) problems.push('Add an uppercase letter.');
  if (!/[0-9]/.test(value)) problems.push('Add a number.');
  if (!/[^A-Za-z0-9\s]/.test(value)) problems.push('Add a symbol.');
  if (/\s/.test(value)) problems.push('Remove spaces.');
  if (/(.)\1{3}/.test(value)) problems.push('Avoid repeating the same character four times.');
  if (identifiers.some((item) => lower.includes(item))) problems.push('Do not include your name, email, or user ID.');
  return [...new Set(problems)];
}

export function hashPassword(password, iterations = PASSWORD_ITERATIONS) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(String(password), salt, iterations, PASSWORD_BYTES, 'sha256');
  return `pbkdf2_sha256$${iterations}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password, encoded) {
  try {
    const [algorithm, iterationsText, saltText, hashText] = String(encoded).split('$');
    if (algorithm !== 'pbkdf2_sha256') return false;
    const iterations = Number.parseInt(iterationsText, 10);
    if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) return false;
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');
    const actual = pbkdf2Sync(String(password), salt, iterations, expected.length, 'sha256');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function secureEqual(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function generateTemporaryPassword() {
  return `Temp!${randomBytes(12).toString('base64url')}9a`;
}

