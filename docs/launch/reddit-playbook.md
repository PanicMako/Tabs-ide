# Reddit launch playbook for Tabs

Written Tuesday 10 Nov 2026. I couldn't open Reddit directly (it's blocked for my tools), so the rules below come from news reports and third-party rule trackers. **Before each post, open the subreddit's sidebar ("About" → Rules) and pinned posts and check them yourself.** Each one takes two minutes and is the difference between a post and a ban.

---

## Is Reddit a good idea? Honest answer

**Yes, as one channel, not the only one.** Reddit is good for honest feedback and a first handful of real users. It's harsh on anything that smells like an ad, and lots of AI-tool posts get ignored or downvoted because there are so many of them. Expect most posts to get somewhere between 5 and 50 upvotes. One or two might do well. That's normal and fine.

What works on Reddit is **a person with a story asking for feedback**. Press-release copy doesn't. You already have the story (the internship and window-juggling) and the honesty (the T3 Code fork). Lead with those.

---

## Step 0: before you post anything (10 minutes)

1. **Check your account.** Open your profile and note your **karma** and **account age**. Many subs auto-remove posts from accounts with low karma (often anything under ~10–200) or that are only a few days old. If AutoModerator removes your post, its message usually says what you're missing.
2. **If karma is low:** post in **r/SideProject today** (it's known for having no karma gate), and spend 20 minutes leaving genuinely helpful comments in r/ClaudeAI or r/ChatGPTCoding. Tomorrow you'll have more options.
3. **Have ready:**
   - The **30–45 s captioned video** (most people scroll muted). The first 3 seconds should show switching from one project tab to another.
   - 1–2 screenshots (light and dark).
   - Links: `buildwithtabs.com/downloads` and `github.com/PanicMako/Tabs-ide`.
   - The README now has a clear "Built on open source, not from scratch" note near the top plus a Shoutouts section. People *will* check.
4. **Block out 2 hours after each post** to reply to comments. Early replies matter more than anything else.

---

## Which subreddits, in order

| # | Subreddit | Fit | Rules (as reported, verify) | When |
|---|---|---|---|---|
| 1 | **r/SideProject** | ⭐⭐⭐ Best place to start | Built for sharing projects; no formal rule list or karma gate reported. Title style: "Name – short description." Don't repost the same project often. | **Today** |
| 2 | **r/ClaudeAI** | ⭐⭐⭐ Your real users (Claude Code people) | Reportedly needs ~50 karma for a standalone showcase post; otherwise use the **"Built with Claude" megathread**. Use the showcase flair. | Today evening or tomorrow |
| 3 | **r/ChatGPTCoding** | ⭐⭐ Tool-agnostic AI coders; Tabs supports Codex, Claude, Cursor, Copilot… | Unverified. Read the sidebar for a promo or showcase rule or thread. | Day 2 |
| 4 | **r/developersIndia** | ⭐⭐ Big audience, peers and Indian tech recruiters | **Unverified, and one tracker lists self-promotion as banned.** Look for a pinned weekly showcase or "I Made This" style thread and post *only* there. Never as a standalone post unless the rules clearly allow it. | Day 2–3 |
| 5 | **r/coolgithubprojects** | ⭐⭐ Easy, low effort | Reportedly GitHub-hosted projects only, so link the repo. | Day 2–3 |
| 6 | **r/webdev** | ⭐⭐ Front-end crowd, fits your story | **Showoff Saturday only** (self-promo only on Saturdays) | **Sat 14 Nov** |
| 7 | **r/cursor**, **r/codex**, **r/GithubCopilot** | ⭐ Smaller, provider-specific | Unverified; some only allow posts about their own product. Check first. | Week 2 |
| 8 | **r/electronjs** | ⭐ Niche, technical | Showcase posts are usually fine there; frame it as "what I learned embedding Code OSS in Electron." | Week 2 |
| 9 | **r/BTechtards** (~440K) | ⭐ Indian engineering students; peers, not users | A tracker (checked Sep 2026) says self-promotion is restricted and product posts get removed. Only post if a pinned project/showcase thread exists or the mods OK it; otherwise just answer people's questions. | Optional, week 2 |
| 10 | **r/TwentiesIndia** | ✗ General life sub, off-topic for a dev tool | Couldn't find its rules; similar Indian general subs (e.g. r/teenindia) remove link posts from new accounts. A product post will likely be removed or ignored. | Skip, or a story post with no link, only if the rules allow |
| 11 | **r/btech** | ⭐ Students, not your users | Unverified. A pure product post probably won't land. A "4th-year student: what building a real app after my internship taught me" post *might*. Ask the mods if unsure. | Optional, week 2 |

**Skip:**
- **r/opensource.** Since October 2026 it bans any project that *"uses AI, is made by AI, or is intended for AI,"* requires projects and accounts to be a year old, and asking for an exception can get you permanently banned.
- **r/programming.** No self-promotion.
- **r/india, r/indianstartups, r/startupindia.** Off-topic, and promotion there generally needs mod permission.

**Pace:** one subreddit every few hours, at most 2–3 a day. Don't use Reddit's "crosspost" button. Write each post fresh for its audience. Posting the same text to 8 subs in an hour looks like spam to Reddit's filters *and* to people.

**Timing:** r/SideProject, r/ClaudeAI and r/ChatGPTCoding skew US, so their mornings are best: **8–11 am ET ≈ 6:30–9:30 pm IST**. r/developersIndia and r/btech: **IST evenings, 7–10 pm**, or weekend mornings. Today, a good plan is r/SideProject at ~7 pm IST, then r/ClaudeAI a few hours later, or tomorrow.

---

## Post drafts

These are starting points. **Edit them into your own words.** Several AI subs remove posts that read as AI-generated, and readers can usually tell. Keep your natural tone: short sentences, a bit informal.

On naming your employer: the drafts say "a fintech company." Name Mira/FundMore only if you're comfortable with that and your internship agreement allows it. Never share anything internal.

### 1. r/SideProject (today)

**Post type:** text post with the video embedded (or a video post with this as the body).

**Title (short, plain, pick one):**
> I got tired of swiping between 6 windows, so I made this

> One window for my Figma + editor + Codex + browser mess

> Tabs: one tab per project, everything inside it (open source)

**Body:**
> During my internship, my setup for a single project looked like this:
>
> - Figma open for the designs
> - my IDE for tiny tweaks (corner radius, spacing, `em` values) with its built-in terminal for running commands
> - Codex open separately for the AI side
> - two browser windows, one regular and one incognito, so I could test signed-in vs. signed-out
>
> Then I'd three-finger swipe between desktops all day trying to find the right one. My Mac got so cluttered I stopped knowing which window belonged to what.
>
> So I put it all in one place. In **Tabs**, every project gets a tab, and inside it you have:
>
> - **Agents**: chat with Codex, Claude Code, Cursor, Copilot etc. using your own login
> - **Code**: a full Code OSS (VS Code core) editor on the same files
> - **Browser tabs**: pin Figma, localhost or anything else to the project's toolbar. Each one can use its own browser profile, so a regular and a separate signed-in session sit side by side, no incognito juggling
> - **Terminal tabs**: saved commands per project
> - **Git**: diffs, branches, commits, PRs
>
> Switch the project tab and all of it switches with you. A shortcut (⌘⌥K) pulls up a quick wheel to jump back to code, start a chat or open a throwaway browser or terminal.
>
> **Being upfront:** I didn't build this from scratch. It started as a fork of [T3 Code](https://github.com/pingdotgg/t3code) (MIT, by T3 Tools), and the editor is Microsoft's Code OSS. I built the project tabs and the workspace around them. The README credits everything.
>
> **It's completely open source and completely free.** No subscription, no paywall, no markup. I'm not trying to make money from it. If your desktop looks like mine did, I hope it helps.
>
> It's a beta, so expect rough edges. The macOS builds aren't notarized yet (System Settings → Privacy & Security → Open Anyway). Works on Windows and Linux too.
>
> **I'm completely open to feedback.** Good, bad, bugs, ideas, "this doesn't work for me because…". Comment here or open a GitHub issue.
>
> Download: buildwithtabs.com/downloads · Source: github.com/PanicMako/Tabs-ide
>
> *A couple of notes:*
> - *If you check my profile, it's basically empty. I've had this account for over a year, but I'm a scroller, not a poster. This isn't a promo account. I'm just a person who built something and wanted to share it. If anyone wants to play around with it, go for it.*
> - *I used AI to help organise my thoughts for this post. The story and the project are mine.*

### 2. r/ClaudeAI

Check the karma rule. Under ~50 karma → post in the **"Built with Claude" megathread** instead. Use the showcase flair. Lead with what a Claude user gets:

**Title:**
> Built a desktop workspace where each project tab has its own Claude Code session, editor, browser and terminal (open source)

**Body:**
> Tabs runs your existing Claude Code login (`claude auth login`) inside a per-project workspace: chat with Claude on the left, the real Code OSS editor with the same files, plus a browser, a terminal and Git, all in one tab per project. Switching projects switches all of it.
>
> It's a fork of T3 Code (MIT), so credit to them for the agent harness. I built the project tabs and the editor/browser/terminal workspace on top. It also supports Codex, Cursor, Copilot and others if you switch between them.
>
> Free, open source, no markup on your Claude usage. Beta, so bugs exist.
>
> [video] · Download / source in the comments.

If the sub wants details on *how Claude was used to build it*, be honest about that too: one line on which parts you built with AI help.

### 3. r/developersIndia (only in a showcase thread, or if the rules clearly allow it)

This audience is your peers and potential referrers, so the job angle works here, but softly.

> Final-year student here. During my front-end internship (fintech, US/Canada) I got fed up switching between 10 windows, so after it ended I built **Tabs**: a desktop workspace with one tab per project. Each tab has its own AI agent, Code OSS editor, browser, terminal and Git.
>
> Honest disclosure: it's built on top of the open-source T3 Code project (MIT), not from scratch. My work was [3 things]. Learning to extend a big codebase I didn't write was the most valuable part.
>
> Free and open source, public beta on Mac / Windows / Linux. Feedback welcome, and if anyone's team is hiring front-end / full-stack folks, I'd love to chat.
>
> [video] · GitHub link

### 4. r/btech (optional, week 2: lesson, not ad)

**Title idea:**
> What I learned shipping a real desktop app after my 4th-year internship (built on open source, not from scratch)

Write 4–5 short lessons (forking vs. starting fresh, reading a huge codebase, getting builds working on Mac/Windows/Linux, actually shipping). Put the link at the end. Ask the mods first if the rules are unclear.

### 5. r/coolgithubprojects

> **Tabs: desktop workspace with one tab per project (AI agents + Code OSS editor + browser + terminal + Git)**. Fork of T3 Code, MIT. [GitHub link]

### 6. r/webdev (Saturday only)

Video plus 3 lines. Lead with the front-end intern angle, and mention it's Electron + React.

---

## Comments you'll probably get, and how to answer

| Comment | Answer (in your words) |
|---|---|
| "It's just a T3 Code fork." | "Yep, said so up top and in the README. What I added is X, Y, Z. Totally fair if T3 Code alone fits you better." |
| "Why not just use VS Code / Cursor?" | "If one window works for you, that's great. Tabs is for when you're jumping between several projects and want the agent, browser and terminal to follow." |
| "macOS says it's damaged / can't be opened." | Give the exact Privacy & Security → Open Anyway steps, and say notarization is planned. |
| "Is this vibe-coded?" | Be honest about how much AI you used and what you understood and debugged yourself. Honesty earns respect here; dodging it doesn't. |
| A bug report | "Thanks! Can you open an issue with your OS + version?", then link the issue template. Fix the bug fast and reply when it's fixed. |
| Something rude | Don't argue. Reply once politely, or not at all. |

---

## Don'ts (these get people banned)

- Don't ask friends, WhatsApp groups or Discord to upvote. That's vote manipulation under Reddit's sitewide rules, and accounts get suspended for it.
- Don't delete and repost to "try again." Mods notice.
- Don't post the same text to many subs, and don't post more than one sub every few hours.
- Don't argue with mods. If a post is removed, read the reason, fix it, or move on.
- Don't let promotion be most of what your account does. The common rule of thumb is that 90% of your activity should be normal participation.

---

## After today

- Note which post got the most real comments (not just upvotes). That framing is what you reuse on X and LinkedIn.
- Turn every bug report into an issue, and ship a small fix release within a few days. Then reply on the original threads: "fixed in v2.3.2, thanks u/…". That brings people back.
- Keep a list: downloads, GitHub stars, issues opened, and one or two quotes from users. Those go on your résumé and into interviews.

## Sources

- r/opensource AI ban: [Help Net Security, 26 Oct 2026](https://www.helpnetsecurity.com/2026/10/26/reddit-r-opensource-ai-ban/)
- r/SideProject: [growreddit](https://www.growreddit.com/blog/reddit-self-promotion-rules-sideproject) · [rankhog](https://rankhog.com/subreddits/sideproject) · [redditmaster](https://www.redditmaster.com/subreddit-rules/sideproject)
- r/ClaudeAI karma / "Built with Claude" megathread: [usehourly planning issue](https://github.com/Zontak-LLC/usehourly/issues/8) (third-party)
- Subreddits allowing promo: [okara](https://okara.ai/blog/subreddits-that-allow-self-promotion) · [launchengine](https://launchengine.app/launch/best-subreddits-to-launch-a-developer-tool)
- r/webdev Showoff Saturday & r/developersIndia listing: [rankhog r/webdev](https://rankhog.com/subreddits/webdev) · [redditmaster r/webdev](https://www.redditmaster.com/subreddit-rules/webdev)
- Indian startup subs: [Thread Otter r/indianstartups](https://www.threadotter.com/subreddit-rules/indianstartups) · [r/startupindia](https://www.threadotter.com/subreddit-rules/startupindia)
- Karma gates & removals: [Postiz](https://postiz.com/blog/reddit-karma-requirements) · [Adaptly](https://adaptlypost.com/blog/reddit-post-removal-causes-fixes-prevention)
- Reddit-wide self-promo norms: [redship](https://redship.io/blog/reddit-self-promotion-rules) · [growreddit 90/10](https://www.growreddit.com/blog/reddit-self-promotion-rules)
