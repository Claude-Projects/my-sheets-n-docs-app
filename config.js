// Public, non-secret deployment configuration.
//
// Nothing in this file is a credential. OAuth client IDs and browser API keys
// are designed to be embedded in client-side code; access is protected by the
// "Authorized JavaScript origins" / "HTTP referrer" restrictions you set in
// Google Cloud Console. See docs/SETUP.md for the step-by-step guide.
//
// Leave a value empty ("") to disable that feature. When googleClientId is
// empty the app shows the setup guide instead of the login button, and demo
// mode stays available so anyone can explore the app without an account.
window.APP_CONFIG = {
  appName: "LedgerDrive",

  // OAuth 2.0 Client ID (type: Web application). Required for Google login.
  googleClientId: "",

  // Optional: browser API key restricted to the Google Picker API. Enables the
  // "Pick from Drive" button used to open spreadsheets other people shared
  // with you. Leave empty to hide that button (open-by-link still works).
  googleApiKey: "",

  // Optional: your Google Cloud project *number* (not the ID). Required by the
  // Picker so that files a user picks are authorised for this app.
  googleProjectNumber: "",

  // Name of the top-level folder created in each user's Google Drive.
  driveRootFolderName: "LedgerDrive",

  // Default currency / locale for new users (can be changed in Settings).
  defaultCurrency: "PKR",
  defaultLocale: "en-PK",
};
