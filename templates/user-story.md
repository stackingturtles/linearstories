---
project: "Q1 2026 Release"
team: "Engineering"
---

## Account access

```yaml
linear_id:
linear_url:
priority: 2
labels: [Epic, Auth]
status: Backlog
```

Provide secure account access and recovery flows across the product.

### Scope

- Email and password login
- Account lockout protection
- Password recovery

### Why is this needed?

Users need a secure and consistent way to access their accounts and recover access without support intervention.

## As a user, I want to log in so that I can access my account

```yaml
linear_id:
linear_url:
epic: Account access
priority: 2
labels: [Feature, Auth]
estimate: 3
assignee: jane@company.com
status: Backlog
```

User should be able to log in with their email and password.
The system should support rate limiting after 5 failed attempts.

### Acceptance Criteria

- [ ] User can enter email and password on the login page
- [ ] Invalid credentials show a clear error message
- [ ] User is redirected to the dashboard on successful login
- [ ] Account locks after 5 consecutive failed attempts

## As a user, I want to reset my password so that I can regain access

```yaml
linear_id:
linear_url:
epic: Account access
priority: 3
labels: [Feature, Auth]
estimate: 2
```

User should be able to reset their password via email link.

### Acceptance Criteria

- [ ] User can request a password reset from the login page
- [ ] Reset email is sent within 60 seconds
- [ ] Reset link expires after 24 hours
