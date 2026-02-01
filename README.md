# schneegerverteiler
Just a little cost splitting webapp

## Firebase setup for Vercel/GitHub deploys
- The Firebase SDK is declared in `package.json` so Vercel installs it during build.
- After pulling the repo locally (if you run it yourself), run: `npm install`.
- Ensure Firestore + Anonymous Auth are enabled in your Firebase project, and deploy as usual.
