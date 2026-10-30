# Mobile app

Uses Expo SDK 58, Expo Router, and Firebase Authentication with Google Sign-In.

## Prepare and configure

Run `npm ci` in this directory. Copy `.env.example` to `.env.local` and replace
every placeholder with your approved Firebase project's public web app configuration
and OAuth client IDs. Enable the Google provider in Firebase Authentication.
Never put client secrets, service-account credentials, or real user data here.
`EXPO_PUBLIC_*` values are included in the application bundle.

- Web: add your development hostname to Firebase Authentication's authorized
  domains. Firebase manages the Google popup and session persistence.
- Android: register `com.trainwatch.app` and its signing certificate SHA-1 with
  the same Google project. Set the OAuth **web** client ID, not the Android ID.
- iOS: register `com.trainwatch.app` and set its iOS OAuth client ID.
  `app.config.ts` adds the reversed client-ID callback scheme. This app uses the
<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:87bab5a4dca30234c572120268292d543749daff4380b5e8ab44784a5b74d30c -->

  Firebase JS SDK and explicit OAuth client IDs for authentication.

Android notification builds also need the matching Firebase `google-services.json`.
Keep the local file at `mobile/google-services.json` (it is ignored by Git).
For EAS, create a secret file variable named `GOOGLE_SERVICES_JSON` in each of
its `preview` and `production` environments through the EAS dashboard or CLI.
The build profiles select those environments, and app config uses the file path
provided by EAS. Local builds fall back to `./google-services.json`.

<!-- /coderabbit-ai-generated:v1 -->

See the [Expo Google authentication guide](https://docs.expo.dev/guides/google-authentication/)
and [Firebase Google provider setup](https://firebase.google.com/docs/auth/web/google-signin).

## Run

Use `npm run web` for web. Native Google Sign-In requires a native development
or release build with the installed Google module. It cannot authenticate in
Expo Go. Rebuild native applications after changing OAuth configuration; follow
the repository's EAS build guidance in `AGENTS.md`.

Without configuration, the app shows the landing screen and sign-in returns a
configuration error. It never creates a demo identity. Existing demo profile
cache entries are discarded; users must sign in again. Firebase owns identity
verification and session persistence. Native Google ID tokens are exchanged
with Firebase before the app receives a user profile.

Routes are `/` (sign-in) and `/home` (authenticated). Expo Router protects both
routes, including `trainwatch://home`. Protected routes redirect signed-out users
to sign-in. This repair does not implement the backend API client.

## Checks

- `npx tsc --noEmit`
- `npx expo lint src/app src/services src/screens app.config.ts`
- `node --test tests/auth.test.cjs`
- `npx expo export --platform web` (requires no live credentials)

Real Google sign-in, restart, cancellation, and sign-out still require verification
with approved project configuration on each target device/browser.
