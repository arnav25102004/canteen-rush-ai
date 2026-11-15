// Extends app.json. On EAS cloud builds google-services.json (gitignored) is
// supplied as a file secret: `eas secret:create --scope project --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json`.
// Locally the env var is unset, so the ./google-services.json file is used.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON || config.android.googleServicesFile,
  },
});
