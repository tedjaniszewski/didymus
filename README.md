# Didymus

A small web app for memorizing poems and Scripture: one poem and one passage at a time, with practice modes (first letters, hidden text, a typing game), a memory bank of everything you have learned, and spaced-repetition review.

Named for Didymus the Blind (c. 313–398), who is said to have known the whole of Scripture by heart.

It is a static site. It needs no server and no accounts, and it runs on GitHub Pages as is. Each person's progress is stored in their own browser.

## Publish on GitHub Pages

1. Create a new repository on GitHub (for example `didymus`). It can be public or private, but Pages on a private repository needs a paid plan.
2. Upload every file in this folder to the root of the repository, keeping the `icons/` folder. Include the hidden `.nojekyll` file. Uploading through the web page works: **Add file → Upload files**, then drag the folder contents in.
3. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, then branch `main` and folder `/ (root)`. Save.
4. After a minute the site is live at `https://<your-username>.github.io/didymus/`.

## Install on a phone

- **iPhone:** open the site in Safari, tap **Share → Add to Home Screen**.
- **Android:** open it in Chrome, tap **⋮ → Install app**.

Once installed, it opens full-screen and works offline. On iPhone, installing also protects the saved data. Safari can delete the stored data of a website you haven't visited for several weeks, but it doesn't do this for apps on the home screen.

## Where the data lives

Everything is kept in the browser's `localStorage` on that device: the queue, your own entries, the memory bank and the review schedule. Nothing is sent anywhere, so:

- Progress doesn't sync between devices. Use **Backup & settings → Export backup** and import the file on the other device.
- Clearing the browser's website data erases it. Export a backup now and then. A red dot appears next to *Backup & settings* when you haven't made a backup in a month.
- Everyone who opens your site gets their own, separate copy.

## Morning reminder

A web page can't schedule a notification by itself, but the phone can open the page:

- **iPhone:** open **Shortcuts → Automation → + → Time of Day**, set it to 7:00 daily, add the action **Open URLs** with your site's address, and choose *Run Immediately*.
- **Android:** use a daily Routine (Google Assistant or Samsung Modes & Routines) that opens the link.

## Adding material

In the app, go to **Queue → + Add a poem / + Add a passage**.

- **Poems:** one line of the poem per line. Indent with spaces or a tab (4 spaces is one level). Leave a blank line between stanzas.
- **Scripture:** choose *Prose* or *Poetry (lines)*. Verse numbers are optional; write them in brackets, as in `[6] Have no anxiety … [7] And the peace …`. Type `LORD` in capitals to get small capitals.

To change the *built-in* library that every new visitor starts with, edit `library.js`. Its format is described at the top of the file. New items you add there show up at the end of existing users' queues. Items you remove don't disappear from anyone's memory bank.

## Spaced repetition

When you mark an item memorized, it goes into the memory bank with its first review due in 3 days. Each review is graded **Again / Hard / Good / Easy**, and the next interval follows a modified SM-2 schedule:

- **Again:** back to 1 day, the item becomes a little harder to space out (ease −0.20), and it is shown once more before the session ends.
- **Hard:** the interval × 1.2, ease −0.15.
- **Good:** the interval × ease (2.5 to start).
- **Easy:** the interval × ease × 1.3, ease +0.15.
- **Late reviews earn credit.** If you recall something 10 days after it was due, Good counts half of that extra time and Easy counts all of it, so skipped days are no penalty.
- **Early reviews** never shorten an interval.
- Intervals of a week or more get ±5% random variation, so items memorized on the same day spread apart. The longest interval is one year.
- A review session holds 20 items, most overdue first.

## Updating

When you change any file, also change `VERSION` at the top of `sw.js` (for example `didymus-v2`). Installed copies then fetch the new version the next time they're opened online.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell |
| `style.css` | Typography and layout (Alegreya, from Google Fonts) |
| `app.js` | The application |
| `library.js` | Default poems and verses |
| `manifest.webmanifest`, `icons/` | Home-screen installation |
| `sw.js` | Offline support |

## Licensing notes

- The code is under the MIT License (see `LICENSE`).
- The poems in `library.js` are in the public domain. The edition of each is noted with the poem.
- Default verse list: the Navigators' *Topical Memory System* (references only).
- Scripture quotations are from the Revised Standard Version of the Bible: Catholic Edition, copyright © 1965, 1966 the Division of Christian Education of the National Council of the Churches of Christ in the United States of America. Used by permission. All rights reserved. The NCC grants blanket permission to quote a limited number of verses with this notice. Check its current terms before publishing the site publicly, since the default library is mostly Scripture.
