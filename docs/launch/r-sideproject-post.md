# r/SideProject post: copy-paste kit

## Title

Main:

```text
My Figma, editor, Codex and two browsers were all separate windows, so I built one window where I can work on all my projects with all my tools
```

Shorter backup:

```text
My Figma, editor, Codex and two browsers were all separate windows, so I put every project and tool in a single window
```

## Body (plain text, no formatting symbols, so paste it into the normal editor as-is)

```text
During my internship I was usually on two or three projects at once, and every project meant a pile of windows. Figma for the designs. My IDE for small tweaks like corner radius and em values, with its terminal for running stuff. Codex in its own window. And two browsers, one normal and one incognito, so I could check logged in and logged out.

So I was three finger swiping between desktops all day trying to find the right window, and half the time I'd end up in the wrong project. My Mac just felt messy.

I wanted all of that in one place, so I built Tabs. It's one window, each project gets a tab at the top, and that tab holds everything for the project: the AI chat (Codex, Claude Code, Cursor, Copilot, it uses your own login), a proper code editor, browser tabs like Figma or localhost, terminals and git. You switch projects and everything comes with it. The browser tabs can each have their own profile too, which replaced my incognito trick.

I should say upfront I didn't write this from zero. It started as a fork of T3 Code (it's MIT licensed) and the editor is Code OSS, which is the open source part of VS Code. What I did was build the project tabs and the workspace around them. It's all credited in the readme.

It's free and open source. No paid plan, nothing on top of what your AI provider already charges you. I made it because I wanted it, and figured someone else might have the same mess I had.

Some stuff to know before trying it. It's a beta so there are bugs. I don't have an Apple developer account, so macOS will block it the first time you open it. Go to System Settings, then Privacy & Security, scroll down and hit Open Anyway. Or build it from source if you'd rather not. It works on Windows and Linux too.

Any feedback helps, including "this isn't for me" and why. You can comment here or open an issue on GitHub.

Download: https://buildwithtabs.com/downloads
GitHub: https://github.com/PanicMako/Tabs-ide

Side note, my profile is pretty much empty. I've had the account for over a year but I mostly just scroll, so this isn't a promo account. I also used AI to help me sort out my thoughts for this post, but the story and the project are mine.
```

## Ready replies (rewrite them in your own words)

**"It's just a T3 Code fork."**
```text
Yep, said that up top. T3 Code is the base for the agent side. What I added is the project tabs, the embedded editor, and the per-project browser/terminal setup. If T3 Code alone fits how you work, that's totally fair.
```

**"Why not just use VS Code / Cursor?"**
```text
If one window works for you, honestly that's great. This is for when you're bouncing between a few projects and want the browser, terminal and agent to follow the project instead of living in separate windows.
```

**"macOS says it can't be opened / is damaged."**
```text
Sorry about that. The builds aren't notarized yet (no Apple dev account). Try to open it once, then go to System Settings → Privacy & Security, scroll down and click Open Anyway. You can also build from source; the steps are in the README.
```

**"Is this vibe-coded?"**
```text
I used AI tools while building it, same as most people now, but I read, debugged and wired things together myself. The base is T3 Code, which I credit in the README. Happy to answer anything about how a specific part works.
```

**Bug report**
```text
Thanks for trying it! Could you open an issue with your OS and Tabs version? https://github.com/PanicMako/Tabs-ide/issues. I'll look at it this week.
```

**"Nice, will try it."**
```text
Thanks! Let me know what feels off. Early feedback is the most useful.
```
