# E2E Tests

Playwright smoke tests run the real renderer against mocked preload services.

Current coverage includes first-run onboarding, navigation, mod import, profile
switching, load ordering, modpack import/export, vanilla launch, modded launch,
restart confirmation, and diagnostics.

These tests must not launch Steam, Clawed, UE4SS, or access real game
installations. Packaged-app E2E should use fake main-process services when that
harness is added.
