# Tabs public beta: launch plan

Researched 2026-11-10. The goal is not revenue. It's (1) real people trying Tabs and giving feedback, and (2) a launch you can point to when applying for jobs.

---

## 0. The honest read first

**What Tabs is up against.** "Desktop app for coding with AI agents" is one of the most crowded categories of 2026: Conductor, Paradev (formerly Superset), Orca, Nimbalyst (formerly Crystal), Zed, Cursor, and T3 Code itself. Theo has publicly said he is tired of *"one more T3 Code fork with a kanban for agents."* If Tabs is pitched as "another agent manager," people will scroll past.

**What actually makes Tabs interesting.** Lead with the problem, not the feature list. Most tools in this space are about running *more agents in parallel*. Tabs is about **not juggling windows**: one tab per project, and inside it the agent chat, a real Code OSS editor, a browser, a terminal and Git, all scoped to that project. That's the internship story, and it's a different pitch from "parallel worktrees."

**Why people will click:**
1. A relatable story ("I was a front-end intern drowning in windows").
2. A short video that shows the switch: project A → project B, and everything follows.
3. Radical honesty: "Forked from T3 Code, editor is Code OSS. Here's what I added." On HN and Reddit, honesty is disarming. Hiding it gets torn apart.
4. Free, open source, uses your own Claude/Codex/Cursor login, no markup.

**What will put people off (fix or disclose):**
- macOS builds are unsigned. Since Sequoia, the Control-click bypass is gone, so users have to go to System Settings → Privacy & Security → Open Anyway. Many HN/Reddit visitors will bounce here.
- Git history: the first commit is `feat: Tabs IDE - complete workspace`, and GitHub doesn't show the repo as a fork. A known Show HN failure mode is a commenter pointing out that *"the initial commit makes it look like you wrote all the code."* (Fix in §1.)
- Scratch files are tracked in the public repo (`tabs-app/fix_*.py`, `debug_*.ts`, `all_chunks.txt`, `test_*.ts`, `scratchpad_ux.js`). Visitors *will* open the repo. Before launch it should look intentional.

**How it helps with jobs:** a launched, used, honestly-credited project with a real story is a better interview topic than a polished-looking repo nobody uses. Interviewers will ask "what was hard?" Have three answers ready (see §6).

---

## 1. Pre-launch checklist (about a week)

### Must do
- [ ] **Credits at the top of the README**, not line 100. Suggested block right under the title:
  > Tabs started as a fork of [T3 Code](https://github.com/pingdotgg/t3code) (MIT, by T3 Tools). The embedded editor is [Code OSS](https://github.com/microsoft/vscode). Synara inspired the multi-agent flow. What Tabs adds on top: project tabs, the embedded editor integration, per-project browser/terminal tabs, Quick Actions, Tabs Exchange, … (see "What I built" below).
- [ ] **A "What I built vs. what I inherited" section** in the README. A short, honest table. This is your best defense against "it's just a fork" and also your best job-interview artifact. (Only you can fill this in accurately.)
- [ ] **LICENSE:** keep the T3 Tools copyright line (MIT requires it) and add your own line underneath for your modifications, e.g. `Copyright (c) 2026 <your name> (Tabs modifications)`.
- [ ] **Clean the repo root of `tabs-app/`:** move the tracked scratch/debug scripts out or `.gitignore` them. (I haven't touched these. Your CLAUDE.md says to ask before deleting, so tell me if you want it done.)
- [ ] **Deploy the redesigned site** (the lab pages are still uncommitted locally).
- [ ] **Cut the video three ways:**
  - 30–45 s, captioned, no voiceover needed (for X, Reddit, LinkedIn autoplay, which is mostly muted)
  - under 2 min 20 s (X's free-account limit)
  - a GIF or 10 s loop for the top of the README
  - The first 3 seconds must show the *switch* between two projects. No logo intro.
- [ ] **A "Known issues" section** (unsigned builds, beta bugs, which providers are tested most). It sets expectations and gets you fewer angry comments.
- [ ] **Open GitHub Discussions** (or point "Community" at it) so feedback has somewhere to go.

### Strongly recommended
- [ ] **Apple Developer Program ($99/yr) to sign and notarize macOS builds.** This is the single biggest conversion fix, because most of your HN/X audience is on Mac. If that's not affordable right now, put the "Open Anyway" steps with a screenshot right on the download page, and say plainly that you'll notarize once you can.
- [ ] **Warm up accounts.** Brand-new HN accounts with no karma can get auto-killed. Spend the week before leaving a few genuine comments on HN and in the subreddits below. Same on Reddit: many subs filter zero-karma accounts.
- [ ] **Read each subreddit's sidebar rules yourself on the day.** Third-party rule summaries contradict each other.

### Don't
- Don't ask friends to upvote your HN post. Vote rings get detected and penalized, and HN's guidelines forbid soliciting votes.
- Don't post the same text everywhere on the same hour. Each place gets its own version.
- Don't disclose anything internal from Mira/FundMore. Keep it to "I was a front-end intern juggling a lot of windows." No internal tool names, screenshots, or client details. Check your internship agreement if you're unsure.

---

## 2. Where to launch, in order

| When | Where | Why | Format |
|---|---|---|---|
| Day −7 → −1 | X (and Bluesky if you use it) | Build a tiny run-up: 2–3 posts about building it, with clips | Short clips, "here's a thing I'm shipping next week" |
| **Day 1 (Tue/Wed), ~8 am PT** | **Show HN** | Highest-quality technical feedback; drives GitHub stars | Title + link to GitHub repo + first comment *you write yourself* |
| Day 1, ~1 hr after HN | **X launch post** | Your story + video, credit T3 Code | Native video, links in first reply |
| Day 2 | **r/SideProject** | Explicitly allows launches; story posts do well | Story post + video (draft below) |
| Day 2–3 | **r/ClaudeAI, r/ChatGPTCoding, r/cursor, r/codex** (whichever allow it) | Your actual users: people who already use CLI agents | Use the showcase flair; lead with "uses your own login, no markup" |
| ~~Day 3–4~~ | ~~r/opensource~~ **skip** | Since Oct 2026 it bans any project that "uses AI, is made by AI, or is intended for AI," and requires 1-year-old projects and accounts | n/a (see [reddit-playbook.md](reddit-playbook.md)) |
| Saturday | **r/webdev Showoff Saturday** | Web devs = front-end story fits | Video + 3 lines |
| Day 3–5 | **LinkedIn** | **This is the job channel.** Recruiters and ex-colleagues see it | Story post (draft below) |
| Week 2 | **dev.to / Hashnode technical write-up** | Lasting, searchable, job-portfolio piece; the only acceptable way to reach r/programming (educational, not promo) | "What I learned embedding Code OSS inside a T3 Code fork" |
| Week 2–3 | **Product Hunt** (optional) | Dev tools and open source are growing categories there, but results vary a lot for solo makers with no network | Only after fixing week-1 feedback |
| Anytime | awesome-lists (awesome-claude-code, awesome-electron, etc.), r/coolgithubprojects, Indie Hackers, daily.dev | Long-tail discovery | PR / short post |

**Skip:** r/programming direct promo (not allowed), Lobsters (invite-only unless someone invites you).

---

## 3. Hacker News (Show HN)

**Rules that matter:**
- It has to be something people can try right now (it is: downloads + source). No landing pages, so **link the GitHub repo**, not the marketing site.
- **The HN moderators have asked that Show HN text be written by hand, not generated or edited by an LLM.** So I'm *not* drafting your HN text. Use this outline and write it in your own words; your natural voice is honestly better for HN anyway.

**Title shape:** `Show HN: Tabs – one desktop window per project for agents, editor, browser and terminal`. Plain. No "revolutionary," no version number.

**First-comment outline (you write it):**
1. One line: what it is.
2. The story in 2–3 sentences: intern, too many windows, wanted one place per project.
3. Honest lineage: forked T3 Code (MIT), editor is Code OSS. List 3–5 things you built on top.
4. What's rough: unsigned macOS builds, beta bugs, which providers you've tested most.
5. What feedback you want ("Is the per-project tab model useful, or do you prefer one window per repo?").

**On the day:** post Tue–Thu around 7–10 am PT. Stay in the comments for the first 3–4 hours. Answer every question, and say "you're right, filing that" a lot. If someone says "it's just a T3 Code fork," agree and point at your "what I built" table. Don't argue.

---

## 4. X (Twitter)

- First line = product name + what it does, because most people only read line one.
- Upload the video natively. Put links in the **first reply** (posts with links get less reach).
- Credit T3 Code in the post. Tagging Theo is fine as *credit*, not as a request for a retweet. He's said publicly that he likes elaborate T3 Code forks; he's also tired of generic ones, so the "windows per project" angle matters.
- Best windows: Tue–Thu morning or early evening US Eastern.
- Over the next week, keep replying to that thread with fixes ("v2.3.2: fixed X that someone reported"). That kind of building in public is what keeps a launch alive past day 1.

**Draft (edit it into your voice):**

> Tabs: one desktop window, one tab per project, and the agent, editor, browser, terminal and Git all follow the tab.
>
> I built it after my front-end internship, where most of my day was alt-tabbing between windows.
>
> Honest bit: it's a fork of T3 Code (MIT) by @theo & team, with Code OSS as the editor. I built the workspace on top. Free, open source, public beta.
>
> 🎥 [video]

Reply 1:
> Download (macOS / Windows / Linux) → buildwithtabs.com/downloads
> Source → github.com/PanicMako/Tabs-ide
> Uses your own Claude Code / Codex / Cursor / Copilot login. No subscription, no markup.

Reply 2:
> What I added on top of T3 Code: [3–4 bullets from your table]
> What's rough: macOS builds aren't notarized yet, so you'll need Privacy & Security → Open Anyway. Bug reports very welcome.

---

## 5. Reddit

**General:** read the sidebar, use the right flair, reply to every comment within the first couple of hours, and don't cross-post the same text everywhere. Write as a person, not a press release. Reddit can smell marketing copy.

**r/SideProject draft:**

> **Title:** I got tired of juggling windows during my internship, so I built Tabs: one window, one tab per project (open source, public beta)
>
> During my 4th year I interned as a front-end engineer at a fintech company. Most of my day was spent bouncing between editor windows, browser tabs, terminals and Git for different projects, and losing my place every time.
>
> After the internship I wanted to fix that for myself. Tabs gives each project its own tab, and inside it you get the agent chat, a full Code OSS editor, a browser, a terminal and Git, all scoped to that project. Switch the tab and everything switches with it.
>
> To be completely upfront: I didn't build this from scratch. It started as a fork of T3 Code (MIT licensed, by T3 Tools), the editor is Microsoft's Code OSS, and I borrowed ideas from Synara. What I built on top is [your list]. The README has the full breakdown.
>
> It's free, open source, and works with your own Claude Code / Codex / Cursor / Copilot login. I'm not trying to make money from it. I wanted to ship something real and learn from people using it.
>
> It's a beta, and rough edges include unsigned macOS builds. I'd really like feedback on whether the per-project tab model works for you.
>
> [video] · Download: buildwithtabs.com/downloads · Source: github.com/PanicMako/Tabs-ide

(I wrote "a fintech company" rather than naming Mira/FundMore. Name them only if you're comfortable and it's fine under your internship agreement. Naming the employer adds credibility on LinkedIn more than on Reddit.)

**AI-tool subreddits (r/ClaudeAI, r/ChatGPTCoding, r/cursor, …):** shorter. Lead with "uses your existing Claude Code / Codex login inside a full editor + browser per project," then the honesty line, then the video. Several of these subs remove AI-generated-looking posts, so rewrite it in your own words.

---

## 6. LinkedIn (the job channel)

This is where the "good paying job" part actually happens. Recruiters don't browse HN, but they do see LinkedIn posts from people in their network.

**Draft:**

> Last year I interned as a front-end engineer at Mira / FundMore. One thing stuck with me: how much of my day went to switching between windows instead of building.
>
> So after the internship I built Tabs, a desktop workspace where every project gets one tab, and the AI agent, code editor, browser, terminal and Git all live inside it.
>
> I'll be upfront: I didn't start from zero. Tabs is built on the open-source T3 Code project, with Microsoft's Code OSS as the editor. My work was [the 3 hardest things you built]. Learning to extend a large codebase I didn't write turned out to be the most valuable part.
>
> It's free and open source, now in public beta for macOS, Windows and Linux.
>
> I'm also looking for my next full-time role in front-end / full-stack engineering. If your team works on developer tools or complex web apps, I'd love to talk.
>
> 🎥 [video] · Links in the comments.

**Have three interview-ready stories:**
1. The hardest integration problem (embedding Code OSS? IPC between Electron and the web app? auto-updater?).
2. A bug you chased for days and how you found it.
3. A product decision you made from user feedback after launch (you'll have these after week 1).

Also: pin the repo on your GitHub profile, add Tabs to your résumé with one line of honest lineage, and link the launch posts.

---

## 7. Week 1 after launch

- Triage every issue and comment within 24 h, even with "thanks, on my list."
- Ship one visible fix release within ~3 days and post it as a reply on X/Reddit. It shows the project is alive.
- Track: GitHub stars, downloads (release asset counts), issues opened, and *one* qualitative thing (what people liked). These numbers go into interviews.
- Then write the dev.to technical post.

---

## Sources

- [HN Show HN rules](https://news.ycombinator.com/showhn.html) · [HN guidelines](https://news.ycombinator.com/newsguidelines.html) · [dang on hand-writing Show HN text](https://news.ycombinator.com/item?id=22336638) · [dang: no genai text on HN](https://news.ycombinator.com/item?id=48887149)
- [Show HN playbook 2026 (causo)](https://hub.causo.ai/guides/show-hn-launch-playbook-technical-founders-2026) · [Flowjam HN timing](https://www.flowjam.com/blog/how-to-get-on-the-front-page-of-hacker-news-in-2025-the-complete-up-to-date-playbook)
- [Subreddits for dev tools](https://launchengine.app/launch/best-subreddits-to-launch-a-developer-tool) · [r/SideProject rules summary](https://www.growreddit.com/blog/reddit-self-promotion-rules-sideproject) · [Reddit self-promo rules 2026](https://redship.io/blog/reddit-self-promotion-rules)
- [X launch checklist](https://www.flowjam.com/blog/x-launch-checklist) · [Build in public on X](https://www.flowjam.com/blog/build-in-public-on-x)
- [Product Hunt dev-tool launches 2026](https://hmb-website-25.pages.dev/developer-marketing/how-to-launch-on-product-hunt) · [Daytona PH retrospective](https://daytona.io/dotfiles/how-we-missed-1-on-product-hunter-but-still-won-big)
- Theo on forks: [encouraging forks](https://x.com/theo/status/2040896157535420544) · [why it's open source](https://x.com/theo/status/2119761845448015969) · [tired of kanban forks](https://x.com/theo/status/2108488695141773400)
- Category: [parallel agent tools 2026](https://dev.to/stravukarl/best-tools-for-managing-parallel-ai-coding-agents-in-2026-14l8) · [Paradev agentic IDE comparison](https://paradev.com/compare/best-agentic-ide)
- macOS: [Sequoia Gatekeeper change](https://www.macrumors.com/2024/08/06/macos-sequoia-gatekeeper-security-change/) · [Running un-notarised code](https://eclecticlight.co/2026/08/11/how-can-you-run-code-that-hasnt-been-notarised/)
- Jobs: [side project → job (freeCodeCamp)](https://www.freecodecamp.org/news/how-i-used-a-side-project-to-land-a-job/)

Note: most launch "playbooks" come from marketing blogs that sell launch tools. Treat their timing and number claims as anecdotes, not data.
