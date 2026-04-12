# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 2.x     | :white_check_mark: |
| 1.x     | :x:                |

## Reporting a Vulnerability

If you discover a security issue in this project (e.g., in the Docker image, CI workflow, or dependency chain), please report it responsibly:

1. **Do not open a public issue.**
2. Use [GitHub's private vulnerability reporting](https://github.com/Amet13/tex-thesis/security/advisories/new) to submit your report.
3. You will receive an acknowledgment within **72 hours** and a resolution target of **30 days**.

## Scope

This is a LaTeX document template. It does not process untrusted input or run a network service. Security concerns are primarily related to:

- **CI/CD workflow injection** (e.g., unsafe context expression expansion in GitHub Actions)
- **Supply-chain integrity** of Docker base images and GitHub Actions (all pinned by digest/SHA)
- **Pre-commit hook dependencies** (pinned by version, updated via Dependabot)
- **LaTeX shell-escape** exploitation paths (shell-escape is disabled by default)

## Supply-Chain Hardening

This project follows supply-chain security best practices:

- Docker base image pinned by `sha256` digest
- All GitHub Actions pinned to commit SHAs (not mutable tags)
- Pre-commit hooks pinned to specific versions
- Dependabot configured for automated dependency updates across Docker, GitHub Actions, and pre-commit ecosystems
