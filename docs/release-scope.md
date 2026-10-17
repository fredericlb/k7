# What the first release is

The scope k7 0.1 ships with, and the hazards that scope accepts. Each accepted hazard below turns
into a blocker the day the condition it rests on stops holding.

## The hosted instance is invite-only

An account exists because an admin created it at the identity provider. Nobody signs themselves up.

k7 itself admits **any** account the OIDC issuer vouches for: there is no allow-list in the backend
(`apps/k7/backend/src/media/admin.ts` reads `AUTH_ADMIN_GROUPS` for admins only). So the
invitation lives at the provider, and the provider must keep it there:

- self-registration is closed at the issuer;
- if the issuer serves other applications, k7's client is restricted to the group of invited
  musicians there.

Every signed-in account is therefore someone the operator chose, and these are accepted while that
holds:

| accepted | why it would block an open instance |
|---|---|
| "Find songs" (yt-dlp, Soulseek) is open to every account | it downloads into the library every account shares, on the operator's Soulseek account |
| any account may write any file of the shared library, and edit the shared songbook | a stranger could overwrite or deface what everyone plays from |
| an account's own engine tunnel reaches the library root, private dot-folders included | share tokens and the identity index sit under it |
| no storage quota per account | one account can fill the disk under everyone |
| no self-service account deletion or data export, no privacy policy, no terms, no abuse contact | GDPR and the EU Digital Services Act expect them from a public service |

Opening sign-up means closing every row of that table first.

## Out of scope

- **iOS.** The app is built by CI as an unsigned check (`.github/workflows/ios.yml`) and is not
  distributed.
- **Signed installers.** The macOS and Windows builds are unsigned, so Gatekeeper and SmartScreen
  stop them on first launch; the user guide says how to open them anyway (`docs/desktop-release.md`).
