# Browser profile/checkpoint contracts — batch205

HEAD unchanged: bb89383e8516d6ee6c730579be3e353a8e43a0e9. Complete new browserProfile source99/test111 and checkpointDiff source66/test75 read. Numstat confirms four wholly added files. Reused contracts56files824tests pass; no redundant execution.

Browser helper tests cover built-in collision exclusion, first duplicate wins, custom incognito coercion and control-character rejection. Maximum profile count24 is an exported constant, not enforced by resolveBrowserProfiles itself. App search finds no resolveBrowserProfiles consumer: active BrowserProfilesSettings uses separate BrowserProfileDefinition with personal/work defaults, label/color/createdAt fields. Thus helper tests do not prove app uses default/incognito semantics. browserDefaultProfileId is separately declared in settings; runtime selection remains unverified. Desktop normalization delegates to profileStorage.

Checkpoint contracts preserve ordered-range checks when mapFields adds fields. Tests reject reversed input and result ranges and accept whitespace flags. Selected server query defaults omitted ignoreWhitespace to true; web request builder omits it. Broader UI preference forwarding and runtime diff execution are outside this bounded review and remain unverified here.

No production edits. Full original audit remains active.
