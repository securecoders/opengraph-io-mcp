# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.1.x   | :white_check_mark: |
| < 1.1   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

1. **Do NOT open a public GitHub issue** for security vulnerabilities
2. Email security concerns to: **security@securecoders.io** (or open a private security advisory on GitHub)
3. Include as much detail as possible:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your report within 48 hours
- **Assessment**: We will investigate and assess the vulnerability within 7 days
- **Resolution**: Critical vulnerabilities will be addressed as quickly as possible
- **Disclosure**: We will coordinate with you on public disclosure timing

### Security Best Practices for Users

When using this MCP server:

1. **API Keys**: Store your OpenGraph.io API key securely using environment variables
2. **Network Security**: When running in HTTP mode, ensure proper network isolation
3. **Input Validation**: The server validates inputs, but always sanitize data in your applications
4. **Updates**: Keep the package updated to receive security patches

## Scope

This security policy covers:
- The `opengraph-io-mcp` npm package
- The source code in this repository
- Configuration and deployment guidance

## Out of Scope

- Vulnerabilities in dependencies (report to respective maintainers)
- Issues with the OpenGraph.io API itself (report to OpenGraph.io)
- Social engineering attacks
- Denial of service attacks against infrastructure

Thank you for helping keep this project secure! 🔐
