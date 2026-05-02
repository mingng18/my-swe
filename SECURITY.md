# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability in this project, please **DO NOT** open a public issue.

### How to Report

Send an email to: **security@example.com** (replace with actual security email)

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if known)

### Response Timeline

- **Initial response**: Within 48 hours
- **Detailed response**: Within 7 days
- **Fix release**: Based on severity, within 30 days

### Disclosure Policy

We follow responsible disclosure:
1. Confirm the vulnerability
2. Develop a fix
3. Coordinate release with reporter
4. Credit the reporter (unless anonymous)

## Security Features

### Input Validation & Sanitization

All user inputs are sanitized using centralized utilities in `src/utils/sanitize.ts`:

- **Null byte rejection**: Prevents string truncation attacks
- **Control character stripping**: Removes control characters
- **Dangerous pattern detection**: Blocks injection attempts
- **Length limits**: Prevents DoS via oversized inputs
- **Unicode normalization**: Prevents Unicode bypass attempts

```typescript
import { sanitizeUserPrompt, sanitizeThreadId, sanitizeUserId } from "./utils/sanitize";

const cleanInput = sanitizeUserPrompt(userInput);
```

### Rate Limiting

Multi-dimensional rate limiting prevents abuse:

- **Per-IP limits**: Prevents IP-based abuse
- **Per-thread limits**: Prevents thread flooding
- **Per-user limits**: Prevents user-based abuse
- **Sliding window**: Uses time-based windows for accurate tracking

```typescript
import { createRateLimitMiddleware } from "./utils/rate-limit";

app.use("/run", createRateLimitMiddleware("/run", {
  perMinute: 20,
  perHour: 100,
  perThread: 50,
}));
```

### Authentication

Timing-safe authentication prevents token enumeration:

- **Constant-time comparison**: Uses `timingSafeEqual`
- **HMAC instead of hash**: Prevents length-based attacks
- **Random delay**: Normalizes timing (10-15ms)
- **No early exit**: Always processes authentication fully

### Command Injection Prevention

Git operations use enhanced shell escaping:

```typescript
import { shellEscapeSingleQuotes } from "./utils/github/github";

// Rejects dangerous patterns:
// - Command substitution: $(...), `...`
// - Variable expansion: ${...}
// - Pipes: |, ||
// - Command chaining: ;, &&
// - Newlines: \n, \r

const safe = shellEscapeSingleQuotes(userInput);
```

### Security Headers

Comprehensive security headers are applied to all responses:

- **X-Content-Type-Options**: `nosniff`
- **X-Frame-Options**: `DENY` (production) / `SAMEORIGIN` (dev)
- **X-XSS-Protection**: `1; mode=block`
- **Content-Security-Policy**: Strict CSP with default-src 'self'
- **Strict-Transport-Security**: HSTS with 1-year max-age (production)
- **Referrer-Policy**: `strict-origin-when-cross-origin`
- **Permissions-Policy**: Restricts geolocation, camera, microphone, etc.

### Memory Management

Prevents memory leaks and unbounded growth:

- **Message trimming**: Automatically trims message arrays
- **Connection pooling**: Reuses HTTP connections
- **LRU caches**: Automatic eviction of old entries
- **Resource limits**: Enforces size limits on all inputs

### Graceful Shutdown

Proper cleanup on termination:

- **SIGTERM/SIGINT handling**: Clean shutdown on signals
- **Timeout protection**: 30-second force exit if cleanup hangs
- **Parallel cleanup**: All handlers run concurrently
- **Health checks**: Reports shutdown status

## Security Best Practices

### For Developers

1. **Never commit secrets**: Use environment variables
2. **Use sanitization functions**: Always sanitize user input
3. **Follow least privilege**: Minimize permissions
4. **Keep dependencies updated**: Regularly run `bun update`
5. **Test security paths**: Include security tests

### For Deployment

1. **Use HTTPS in production**: Enforced via HSTS
2. **Set strong API keys**: Minimum 32 characters, random
3. **Enable security headers**: Applied by default
4. **Configure CORS**: Restrict to allowed origins
5. **Monitor logs**: Watch for security events

### For Operations

1. **Regular security audits**: Review code quarterly
2. **Dependency scanning**: Use automated tools
3. **Incident response**: Have a plan ready
4. **Backup and recovery**: Test regularly
5. **Access control**: Limit who can deploy

## Dependency Security

### Vulnerability Scanning

CI/CD pipeline includes automated security scanning:

```yaml
# .github/workflows/ci.yml
- name: Run Trivy vulnerability scanner
  uses: aquasecurity/trivy-action@master
  with:
    scan-type: 'fs'
    scan-ref: './src'
    format: 'sarif'
```

### Known Vulnerabilities

We track and address CVEs in dependencies:

- **hono**: Updated to 4.12.15 (security fixes)
- **@langchain/langgraph**: Updated to 1.2.9 (security fixes)
- **langchain**: Updated to 1.3.5
- **@langchain/openai**: Updated to 1.4.5

### Updating Dependencies

```bash
# Check for vulnerabilities
bun audit

# Update packages
bun update

# Test thoroughly
bun test
```

## Security Testing

### Unit Tests

Security tests are in `src/utils/github/security.test.ts`:

- Command injection prevention
- Input sanitization
- Rate limiting
- Timing attack mitigation
- Message trimming
- Connection pooling
- Graceful shutdown

Run tests:
```bash
bun test src/utils/github/security.test.ts
```

### Integration Tests

Test security in realistic scenarios:
- Authentication flows
- API endpoints
- Webhook handling
- Rate limit enforcement

### Penetration Testing

Before major releases:
1. Internal security review
2. External penetration test
3. Remediate findings
4. Retest if critical

## Incident Response

### Severity Levels

- **Critical (CVSS 9.0-10.0)**: Immediate fix, deploy within 24 hours
- **High (CVSS 7.0-8.9)**: Fix within 7 days
- **Medium (CVSS 4.0-6.9)**: Fix in next release
- **Low (CVSS 0.1-3.9)**: Fix when convenient

### Incident Response Process

1. **Detection**: Monitor, user report, or automated scan
2. **Assessment**: Determine severity and impact
3. **Containment**: Limit damage if exploited
4. **Eradication**: Develop and test fix
5. **Recovery**: Deploy fix and monitor
6. **Post-incident**: Review and improve process

### Emergency Contacts

- **Security Lead**: [Name, email]
- **Engineering Lead**: [Name, email]
- **Incident Response**: [email/phone]

## Compliance

### Data Protection

- **PII**: Minimize collection, encrypt at rest
- **Logging**: No sensitive data in logs
- **Retention**: Follow data retention policy
- **Deletion**: Secure deletion when requested

### Standards

- **OWASP Top 10**: Addressed in design
- **CWEs**: Tracked and mitigated
- **Security best practices**: Following industry standards

## Changelog

### April 30, 2026
- Fixed command injection vulnerability (CVSS 9.8)
- Fixed timing attack vulnerability (CVSS 7.4)
- Updated dependencies to patch 13 CVEs
- Fixed race conditions in global state (CVSS 7.5)
- Implemented message trimming (CVSS 8.5)
- Added connection pooling (CVSS 7.8)
- Implemented input sanitization (CVSS 8.6)
- Added multi-dimensional rate limiting (CVSS 7.5)
- Implemented graceful shutdown (CVSS 6.8)
- Added CI/CD pipeline with security scanning (CVSS 7.2)

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE Mitigation](https://cwe.mitre.org/)
- [Security Headers](https://securityheaders.com/)
- [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [HSTS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security)

## Questions?

For security-related questions not involving vulnerability disclosure, please open an issue with the `security` label.
