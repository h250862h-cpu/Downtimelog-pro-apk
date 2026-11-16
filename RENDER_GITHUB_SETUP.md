# GitHub + Render 24/7 Always-Live Deployment Guide (LG PLAST APK)

This project is pre-configured with `render.yaml` and a full offline-first PWA service worker (`vite-plugin-pwa`) + IndexedDB Firestore persistence so the **LG PLAST APK** stays online **24/7 without sleeping** on Render's free Static Site CDN.

---

## Step 1: Push the Project to GitHub
1. Click the **GitHub / Export** button in AI Studio (top-right bar) to create/push directly to a GitHub repository, **OR** download the ZIP and push from your computer:
   ```bash
   git init
   git add .
   git commit -m "LG PLAST Always-Live APK"
   git branch -M main
   git remote add origin https://github.com/<YOUR-GITHUB-USERNAME>/<YOUR-REPO-NAME>.git
   git push -u origin main
   ```

---

## Step 2: Deploy on Render (Free Static Site — Stays Live 24/7)
Render **Static Sites** run on a global CDN and **never sleep** (unlike free Web Services).

1. Sign in to [https://dashboard.render.com](https://dashboard.render.com) with your GitHub account.
2. Click **New +** → **Blueprint** (recommended — reads `render.yaml` automatically) **or** **New +** → **Static Site**:
   - **Repository**: Select your `lgplast-apk` GitHub repo
   - **Branch**: `main`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`
   - **Redirect / Rewrite Rule** (if creating manually instead of Blueprint):
     - Source: `/*` → Destination: `/index.html` → Action: `Rewrite`
3. Click **Create Static Site / Apply**.
4. Within ~2 minutes, your permanent URL (e.g. `https://lgplast-plantops-apk.onrender.com`) goes live 24/7 and auto-redeploys whenever you push to GitHub.

---

## Step 3: Authorize Your Render Domain in Firebase (For Google Sign-In)
1. Open [Firebase Authentication Settings](https://console.firebase.google.com/project/downtime-log-d484f/authentication/settings).
2. Under **Authorized domains**, click **Add domain**.
3. Enter your Render domain (e.g. `lgplast-plantops-apk.onrender.com`) and save.
4. Note: Email/Username & Password logins (Shift In Charge, WH Personnel, Production HOD) work immediately on Render even before adding the domain.

---

## Step 4: Install the LG PLAST APK on Phones & Tablets
1. Open your permanent `https://...onrender.com` link in **Google Chrome** on Android (or **Safari** on iPhone).
2. Sign in once — your session, machines, and logs are cached locally and synced live to Firebase Firestore.
3. Tap **Install APK** in the top bar (or Chrome menu `⋮` → **Install app** / **Add to Home screen**) to get the **LG PLAST** icon directly on the phone's home screen.
4. For shop-floor wall/desk tablets, tap **Keep Screen On** in the top display bar so the screen never dims or disconnects.
