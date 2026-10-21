# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 3.x     | :white_check_mark: |
| < 3.0   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

1. **Do NOT open a public GitHub issue** for security vulnerabilities
2. Open a private security advisory on GitHub (Security tab, **Report a vulnerability**), or email **security@securecoders.io**
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

1. **API Keys**: Keep your OpenGraph.io App ID out of shared or committed files. The CLI installer writes client configs readable by your user only, and the Claude Desktop extension marks it as sensitive so Claude Desktop stores it securely.
2. **Prefer OAuth for the hosted server**: it avoids putting a key in any config file, and access can be revoked from your dashboard.
3. **Web content is untrusted**: pages your agent fetches can contain instructions aimed at it. Review what an agent proposes before letting it act on your files or accounts.
4. **Updates**: Keep the package updated to receive security patches

## Scope

This security policy covers:
- The `opengraph-io-mcp` npm package and the Claude Desktop extension
- The source code in this repository

## Out of Scope

- Vulnerabilities in dependencies (report to respective maintainers)
- Issues with the OpenGraph.io API itself (report to OpenGraph.io)
- Social engineering attacks
- Denial of service attacks against infrastructure

Thank you for helping keep this project secure! 🔐
