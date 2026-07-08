# Setup: getting the shared To Do app live

This app is code-complete but needs two accounts wired up before anyone can use it — a
Supabase project (the shared database) and a Netlify site (the hosting). Both are things
only you can create (they need your login), so these are manual steps.

## 1. Create the Supabase project

1. Go to supabase.com and create a free project (any name/region is fine).
2. Once it's ready, open **SQL Editor** in the left sidebar, paste in the contents of
   [`../supabase/schema.sql`](../supabase/schema.sql), and run it. This creates the
   `profiles` and `boards` tables, sets up the (intentionally open) access policies, and
   turns on Realtime for `boards`.
   - If the last line (`alter publication supabase_realtime add table boards;`) errors
     because the table's already in the publication, that's fine — ignore it.
3. Open **Project Settings > API**. You need two values from this page:
   - **Project URL** (looks like `https://xxxxxxxx.supabase.co`)
   - **anon public** key (a long string under "Project API keys")

## 2. Point the app at your project

Open [`js/config.js`](js/config.js) and replace the two placeholder values with the ones
from step 1:

```js
export const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ...";
```

The anon key is meant to be public (it's the client-side key, safe to ship) — access is
controlled by the policies in `schema.sql`, not by keeping this key secret.

## 3. Deploy to Netlify

Since you already have a Netlify account:

- **Fastest**: on netlify.com, go to **Sites > Add new site > Deploy manually**, and drag
  in this `web/` folder. Netlify gives you a live URL immediately.
- **Better for ongoing changes**: push this `web/` folder to a GitHub repo (it's already a
  git repo — just add a remote and push), then in Netlify choose **Add new site > Import
  from Git** and point it at that repo, with the publish directory set to `web` (or the
  repo root, if you push `web/`'s contents directly as the repo root). Every future push
  then auto-deploys.

Either way, note the resulting URL (e.g. `https://your-team-todo.netlify.app`) — that's
what everyone will use.

## 4. Test it end-to-end before rolling out

1. Open the Netlify URL in a browser. You should see the "Who's this?" prompt.
2. Type a test name, e.g. "Test Person" — since it's new, you'll see "No name found. Make
   new list?" — confirm it, and you should land on a blank list.
3. Type a task (`>Try it out`) and confirm it appears as a box.
4. Click **Team** in the header — you should see your test list as a column.
5. Open a private/incognito window, go to the same URL, use a different name, add a task,
   and confirm it shows up as a second column in the first window's Team view (it should
   update live; if not, a manual refresh of the Team view will still pick it up).
6. Clear that private window's site data (or just use a fresh incognito window) and re-open
   the URL, typing the *first* test name again — confirm it reloads that same list rather
   than starting fresh. This is the "recovery on a new computer" path — worth confirming
   before anyone relies on it.

## 5. Roll it out to the team

See the plan's "Rollout / onboarding a coworker" section — in short: share the URL, each
person installs it once (PWA install or an Edge `--app` shortcut) and picks their name on
first open.

## If something doesn't work

- Blank list / "Couldn't load your list": almost always `config.js` still has placeholder
  values, or the SQL in step 1 didn't run successfully — check the Supabase dashboard's
  **Table Editor** to confirm `profiles` and `boards` tables exist.
- Team view not updating live: confirm `boards` is listed under **Database > Replication
  > supabase_realtime** in the Supabase dashboard; toggle it on if it's off.
