# Frame & Voice

Turns a screen or meeting recording into key frames lined up with the transcript, then exports a context pack (Markdown) and a storyboard PDF that people can hand to any AI.

- Runs entirely in the browser. Videos, transcripts and frames never leave the user's device.
- **Process video**: grabs the key frames, then writes a timestamped transcript from the video's sound (OpenAI's open-source Whisper model, run on the user's own device) unless a transcript was pasted. Free, no account, nothing uploaded. The Transcript tab shows the full transcript.
- **Ask about the recording**: a built-in Ask box answers questions using an AI model hosted by Groq (free tier). It reads the transcript and on-screen notes, not the pictures; only that text and the question are sent, never the video. "Other ways to ask" keeps Open in Claude / ChatGPT / Copilot / Gemini as a backup.
- **Any common video format**: if the browser can't play a file (for example iPhone .MOV/HEVC in Chrome), a built-in converter reads it instead.
- No sign-in for users. Hosting on Vercel's free (Hobby) plan and Groq's free tier costs nothing.
- Installable as an app on desktop (Chrome, Edge) and phones (Android: Install app; iPhone: Share, then Add to Home Screen). Works offline once loaded, including transcription after the first use.

## What's in this folder

```
vercel.json                   Tells Vercel to serve public/ and sets the headers transcription needs
api/ask.js                    Server code for the Ask box: passes questions to Groq, keeps the key secret
public/index.html             The app
public/transcribe-worker.js   Speech-to-text (runs in the background)
public/sw.js                  Offline support for the installed app
public/manifest.webmanifest   App name and icons for installing
public/vendor/                Libraries: PDF maker, video converter, speech-to-text engine
public/icons/                 App icons
```

The largest file is `public/vendor/transformers/ort-wasm-simd-threaded.jsep.wasm` (about 21 MB), which is under GitHub's 25 MB limit for uploads through the website.

## Already live? Update your site

1. Unzip `frame-and-voice-site.zip`.
2. Open your `frame-and-voice` repository on github.com, click **Add file**, then **Upload files**.
3. Drag in **everything inside the unzipped folder** (`vercel.json`, `README.md` and the `public` folder). Files with the same name are replaced.
4. Click **Commit changes**. Vercel republishes automatically within a minute or two.

People who installed the app get the new version the next time they open it while online.

## First time: put it live on Vercel (about 10 minutes, no coding)

### 1. Put the files on GitHub
1. Sign in at github.com (a free account is fine).
2. Click **+** (top right), then **New repository**. Name it `frame-and-voice`. Public or Private both work. Click **Create repository**.
3. On the next page click **uploading an existing file**.
4. Unzip `frame-and-voice-site.zip`, open the unzipped folder and drag **everything inside it** into the upload box. `vercel.json` must sit at the top level, not inside another folder.
5. Click **Commit changes**.

### 2. Connect it to Vercel
1. Go to vercel.com and choose **Log in with GitHub**. Pick the free Hobby plan if asked.
2. Click **Add New…**, then **Project**, find `frame-and-voice` and click **Import**.
3. Leave every setting as it is (Framework Preset: **Other**). Click **Deploy**.
4. You get a link like `frame-and-voice.vercel.app`. That's the link to share.

To rename the address, open the project's **Settings**, then **Domains**.

## Set up the Ask box (once)
1. Go to console.groq.com, sign up (free, no card) and open **API Keys**. Click **Create API Key**, name it `frame-and-voice` and copy the key.
2. In Vercel, open the project, then **Settings**, then **Environment Variables**. Add a variable named `GROQ_API_KEY` with the key as its value, for all environments, and save.
3. Open **Deployments**, click the **⋯** menu on the latest one and choose **Redeploy**.

Until the key is set, the Ask box says asking isn't set up and points people to Other ways to ask.

### How the Ask box works
- Free-tier limits are shared by everyone using the site: roughly 20–40 questions a day on a typical meeting, about one every 20 seconds. When the main model's daily allowance runs out, smaller models take over; when all are used up, people are pointed to Other ways to ask until it resets.
- Long recordings are trimmed to about 14,000 characters: the parts that best match the question, or an even spread for summaries.
- Each person is limited to 12 questions per 10 minutes so one user can't use up the allowance.
- Models used, in order: `llama-3.3-70b-versatile`, `openai/gpt-oss-120b`, `llama-3.1-8b-instant`. To change them, set a `GROQ_MODELS` environment variable in Vercel (comma-separated).
- To move to a paid plan later, upgrade the Groq account; nothing in the site needs to change.

## How transcription works (for anyone who asks)
- The first time someone transcribes, their browser downloads the speech model from Hugging Face (the public home of open-source AI models): roughly 100–250 MB for Standard quality, more for Better. After that it's stored in the browser and starts straight away.
- It uses the computer's graphics chip where the browser allows it (recent Chrome and Edge), otherwise the processor. As a rough guide, an hour of audio takes 5–15 minutes on a recent laptop, longer on older machines. Phones are fine for short clips.
- It writes what was said with timestamps but doesn't label speakers. If a Teams or Zoom transcript exists, that's still the better choice, because it has names.
- Some work networks block Hugging Face. If the download fails at work, try from home or ask IT to allow `huggingface.co`.
- The video converter downloads once (about 30 MB) from the jsDelivr code CDN when a file needs converting or when transcribing.

## Making changes later
Edit files in `public/`. If you change anything, bump `VERSION` at the top of `public/sw.js` (for example `fv-v5` to `fv-v6`) so installed apps pick up the new version.

## Credits
Whisper (OpenAI, MIT licence) via Transformers.js (Hugging Face, Apache 2.0); ffmpeg.wasm (MIT, with FFmpeg under LGPL/GPL); jsPDF (MIT).
