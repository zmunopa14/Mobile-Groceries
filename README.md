# Stockflow — Put it online (no coding)

This folder is a complete, ready-to-publish app. Follow these steps and you'll have a link your mother and the salespeople can open on any phone. You do NOT need to edit any code.

You'll do two things: (A) set up the database once, (B) publish the app with Vercel.

---

## A. Set up the database (once, ~5 min)

1. Go to your Supabase project → click **SQL Editor** (the `>_` icon on the left).
2. Click **New query**.
3. Open the file **setup.sql** (shared with you), copy everything, paste it in.
4. Find the last line:
   `select upsert_member('Mum', '1234', 'admin');`
   Change `'Mum'` to your mother's name and `'1234'` to a PIN she'll remember.
5. Click **Run**. You should see "Success". The database is now ready.

You'll also need two values later, so grab them now:
- In Supabase: **Project Settings (gear) → API**.
- Copy the **Project URL** (looks like `https://bkibshwxeigevybfxvll.supabase.co`).
- Copy the **anon public** key (the long `eyJ...` string). NOT the service_role one.
- Paste both into a note for the next part.

---

## B. Publish with Vercel (~10 min)

### 1. Make a free account
- Go to **vercel.com** → **Sign Up** (the "Continue with Email" option is fine).

### 2. Upload this project
The simplest no-tools route:
1. Go to **github.com**, sign up (free).
2. Click **New repository** → name it `stockflow` → **Create**.
3. On the new repo page, click **uploading an existing file**.
4. Drag in ALL the files from this folder (package.json, index.html, vite.config.js, the `src` folder, etc.) — but NOT the `node_modules` folder if it exists.
5. Click **Commit changes**.

### 3. Connect Vercel to it
1. In Vercel, click **Add New → Project**.
2. Choose **Import** next to your `stockflow` GitHub repo.
3. Vercel detects it's a Vite app automatically — leave the build settings as they are.

### 4. Add your two Supabase values
Before clicking Deploy, open **Environment Variables** and add these two:

| Name | Value |
|------|-------|
| `VITE_SUPABASE_URL` | your Project URL |
| `VITE_SUPABASE_ANON_KEY` | your anon public key |

### 5. Deploy
- Click **Deploy**. Wait ~1 minute.
- Vercel gives you a link like `https://stockflow-xxxx.vercel.app`.
- Open it on your phone. Sign in as admin with the name + PIN from step A.4.

Done. Share that link with the salespeople; they sign in with the names + PINs you create under the **Team** tab.

---

## Tips
- **Add to home screen:** on a phone, open the link, then use the browser menu → "Add to Home screen" so it feels like an app.
- **Changing the admin PIN later:** re-run the `upsert_member(...)` line in the SQL Editor with a new PIN.
- **It says "Almost ready":** that means the two environment variables didn't load — double-check their names are exactly `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel, then re-deploy.
