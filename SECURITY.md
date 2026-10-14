# Security Policy

## Supported versions

Manager NPM is in early development (pre-1.0). Security fixes are made on the latest `main` branch only.

| Version | Supported |
|---|---|
| `main` (latest) | ✅ |
| Anything older | ❌ |

## Reporting a vulnerability

**Please do not report security issues in public GitHub issues, discussions or pull requests.**

Report privately through one of these channels:

1. **GitHub private vulnerability reporting** (preferred): open the repository's
   [Security tab](https://github.com/LienThuan04/Manager-NPM/security) and click **Report a vulnerability**.
2. **Email:** [lienthuan2004@gmail.com](mailto:lienthuan2004@gmail.com) with the subject `[Manager NPM security]`.

Please include:

- A description of the issue and its impact
- Steps to reproduce or a proof of concept
- The affected commit or version, your OS, Node.js and pnpm versions
- Any suggested fix, if you have one

## What to expect

This is a side project maintained by one person, so timelines are best effort:

- Acknowledgement within **7 days**
- An initial assessment and next steps within **14 days**
- Updates while a fix is being prepared, and coordinated disclosure once it is released
- Credit in the release notes if you want it

## Scope and threat model

Manager NPM is a **local, single-user tool**. The API has **no authentication by design** and is meant to listen
only on `localhost`. With that in mind, these are especially relevant:

- Reading, deleting or modifying files **outside `SCAN_ROOT_PATHS`** (path traversal, symlink or junction escapes)
- **Command injection** through package names, script names, versions or paths passed to npm / pnpm / Yarn / nvm
- Bypassing the **preview → confirm** step of a destructive or machine-wide operation
- A web page in the user's browser being able to trigger actions on the local API (CORS / CSRF against `localhost`)
- Leaking secrets from scanned projects (for example `.env` contents) through API responses or logs

Usually out of scope:

- Problems that only occur after the user exposes the API to a network (for example `HOST=0.0.0.0`); this
  configuration is not supported
- Attacks that already require control of the user's account or shell on the machine
- Known vulnerabilities in third-party dependencies with no demonstrated impact on Manager NPM
  (dependency updates are tracked by Dependabot; please report those upstream)
