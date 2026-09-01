# Changelog

## [0.3.0](https://github.com/chrischall/app-store-connect-mcp/compare/v0.2.7...v0.3.0) (2026-09-01)


### Features

* **health:** add asc_healthcheck ([#69](https://github.com/chrischall/app-store-connect-mcp/issues/69)) ([65136e8](https://github.com/chrischall/app-store-connect-mcp/commit/65136e83b11e74a675250ae9d92b0f1ba87285fc))


### Documentation

* **health:** add asc_healthcheck to both SKILL.md files ([#74](https://github.com/chrischall/app-store-connect-mcp/issues/74)) ([bc9bafe](https://github.com/chrischall/app-store-connect-mcp/commit/bc9bafe2628977c0e2906479b2ba9bda0ed513cd)), closes [#73](https://github.com/chrischall/app-store-connect-mcp/issues/73)
* **health:** list asc_healthcheck in manifest.json and the tool docs ([#72](https://github.com/chrischall/app-store-connect-mcp/issues/72)) ([4e99fda](https://github.com/chrischall/app-store-connect-mcp/commit/4e99fdacaa4fbf31dfcfe7f1b85719852a74993b))

## [0.2.7](https://github.com/chrischall/app-store-connect-mcp/compare/v0.2.6...v0.2.7) (2026-08-28)


### Bug Fixes

* shorten the server.json description so the MCP registry accepts it ([#62](https://github.com/chrischall/app-store-connect-mcp/issues/62)) ([5ffc912](https://github.com/chrischall/app-store-connect-mcp/commit/5ffc912bec56d0656e73450337d8512f2ea6f62d))

## [0.2.6](https://github.com/chrischall/app-store-connect-mcp/compare/v0.2.5...v0.2.6) (2026-08-28)


### Bug Fixes

* publish under the [@chrischall](https://github.com/chrischall) scope so npm accepts the package ([#60](https://github.com/chrischall/app-store-connect-mcp/issues/60)) ([7406a3d](https://github.com/chrischall/app-store-connect-mcp/commit/7406a3d6fd5656d2ed04ea0dde50995961b07917))

## [0.2.5](https://github.com/chrischall/app-store-connect-mcp/compare/v0.2.4...v0.2.5) (2026-08-26)


### Bug Fixes

* drop appstoreconnect.apple.com from the mint.yaml egress allowlist ([#56](https://github.com/chrischall/app-store-connect-mcp/issues/56)) ([61c562e](https://github.com/chrischall/app-store-connect-mcp/commit/61c562e12d13d555a10a263ad0a18b7bd4a60b7d)), closes [#53](https://github.com/chrischall/app-store-connect-mcp/issues/53)

## [0.2.4](https://github.com/chrischall/app-store-connect-mcp/compare/v0.2.3...v0.2.4) (2026-07-25)


### Bug Fixes

* **deps:** bump fast-uri out of the host-confusion advisories ([#39](https://github.com/chrischall/app-store-connect-mcp/issues/39)) ([40bd8b9](https://github.com/chrischall/app-store-connect-mcp/commit/40bd8b939ca88ddfc8398b9cc53e0db8a72515ae))

## [0.2.3](https://github.com/chrischall/app-store-connect-mcp/compare/v0.2.2...v0.2.3) (2026-07-19)


### Documentation

* replace duplicated fleet policy with a pointer ([#34](https://github.com/chrischall/app-store-connect-mcp/issues/34)) ([be5ed11](https://github.com/chrischall/app-store-connect-mcp/commit/be5ed11b9d36d3e80f3d09b27540961179b46570))

## [0.2.2](https://github.com/chrischall/app-store-connect-mcp/compare/v0.2.1...v0.2.2) (2026-07-07)


### Bug Fixes

* bump @chrischall/mcp-utils to 0.12.0 ([#28](https://github.com/chrischall/app-store-connect-mcp/issues/28)) ([500cf10](https://github.com/chrischall/app-store-connect-mcp/commit/500cf10e3aa2feab7cf6724ba0d5bdb1cfcabd62))
* confirm-gate destructive and public App Store Connect mutations ([#25](https://github.com/chrischall/app-store-connect-mcp/issues/25)) ([b31c2de](https://github.com/chrischall/app-store-connect-mcp/commit/b31c2debcb34d4f23d324d99a0baa815ef47f504))


### Refactor

* adopt mcp-utils createCachedTokenSource + signEs256Jwt ([#27](https://github.com/chrischall/app-store-connect-mcp/issues/27)) ([efc0f95](https://github.com/chrischall/app-store-connect-mcp/commit/efc0f9549881f10040c5550f4d94d53a3836eac7))


### Documentation

* document first-party dependency-bump label exception ([#29](https://github.com/chrischall/app-store-connect-mcp/issues/29)) ([4e895a7](https://github.com/chrischall/app-store-connect-mcp/commit/4e895a70a47b0ffc5b957c89c4713fb9f6b6619a))

## [0.2.1](https://github.com/chrischall/app-store-connect-mcp/compare/v0.2.0...v0.2.1) (2026-06-30)


### Documentation

* document Conventional Commit PR-title requirement for release-please ([#15](https://github.com/chrischall/app-store-connect-mcp/issues/15)) ([cdb7c66](https://github.com/chrischall/app-store-connect-mcp/commit/cdb7c66f156113fae8043881c4d3d80e451be597))
* refresh versioning section and add auto-review follow-up convention ([#17](https://github.com/chrischall/app-store-connect-mcp/issues/17)) ([836bab6](https://github.com/chrischall/app-store-connect-mcp/commit/836bab681db3ccee0d298d39ee9180379be52695))

## [0.2.0](https://github.com/chrischall/app-store-connect-mcp/compare/v0.1.0...v0.2.0) (2026-06-13)


### Features

* opt-in pagination for list tools following links.next ([80b7af2](https://github.com/chrischall/app-store-connect-mcp/commit/80b7af2c62b54b5ff9e933155c36493d31bdc9de))
* opt-in pagination for list tools following links.next ([5c573b7](https://github.com/chrischall/app-store-connect-mcp/commit/5c573b71c6085f9ae397a0ac91072caa5121cea5))


### Refactor

* migrate AppStoreConnectClient onto the shared mcp-utils API client ([ad9ae0f](https://github.com/chrischall/app-store-connect-mcp/commit/ad9ae0f8087127df188ee7c5df5769081d794b79))


### Documentation

* fix LICENSE holder typo (Chall → Hall) and add README badges ([#8](https://github.com/chrischall/app-store-connect-mcp/issues/8)) ([1044fe1](https://github.com/chrischall/app-store-connect-mcp/commit/1044fe129d11b9aff5ca86eabd9d386f6bba9e38))
