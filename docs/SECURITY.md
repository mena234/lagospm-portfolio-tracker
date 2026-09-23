# Security notes

- Passwords use PBKDF2-SHA256 with unique random salts and 310,000 iterations.
- Password policy requires at least 12 characters with upper case, lower case, number, and symbol. Seeded/bootstrap accounts must change their password at first sign-in.
- Session tokens are random, stored only as hashes, expire server-side, and use `HttpOnly`, `SameSite=Strict`, and production `Secure` cookies.
- All state-changing authenticated requests require the per-session CSRF token and a matching production origin.
- Login attempts are throttled by account and network address. Successful sign-in clears the account's failed-attempt history.
- Viewer, Editor, and Admin authorization is enforced on the server; hidden controls are only a convenience.
- Sensitive actions and authentication events write append-only audit records.
- Content Security Policy, frame denial, MIME sniffing protection, strict referrer policy, and a restricted permissions policy are sent by the application.
- The production service binds to loopback, runs without root privileges, and receives a writable path only for its database.

Use Nginx TLS, OS security updates, encrypted off-host backups, least-privilege SSH, and a secret manager or root-owned environment file. Review audit entries after every administrative change.
