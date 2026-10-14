## Summary

<!-- What does this PR change, and why? -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor / tooling / CI

## How was it tested?

<!-- Commands you ran, manual steps, screenshots for UI changes. -->

## Checklist

- [ ] Backend changed: `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:e2e` pass in `pkgsteward_be/`
- [ ] Frontend changed: `pnpm lint` and `pnpm build` pass in `pkgsteward_fe/` (plus `pnpm theme:check` for style changes and `pnpm i18n:check` for message changes)
- [ ] New UI strings are added to both `messages/vi.json` and `messages/en.json`
- [ ] Destructive or machine-wide actions use preview → confirm, paths stay inside `SCAN_ROOT_PATHS`, and tests mock `execa` / the filesystem
- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/)
- [ ] Documentation is updated if behavior or setup changed
