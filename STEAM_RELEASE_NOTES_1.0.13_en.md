[h1]Deep Space Idle: Frontier Era — Update Notes[/h1]
[quote]Versions: 1.0.12 – 1.0.13 (2026-10-11 – 2026-10-12)[/quote]

[h2]I. New Content[/h2]
[h2]1.0.12[/h2]
[list]
[*][b]New · Potential Chip Decoding[/b]: A new "Potential Chip Decoding" feature is added to the Blueprint Lab, letting you decode "Unknown Potential Chips" into one of three reward types: Enhancement Catalyst Chips, Skill Module Chips, and Rig Affix Chips.
[*][b]Enhancement Catalyst Chip[/b]: A "Use Enhancement Catalyst Chip" toggle is added to the ship and equipment enhancement panels. When enabled, this attempt's success rate increases by 10%. The chip is consumed only on a successful enhancement, never on failure.
[*][b]Skill Module Chip[/b]: When activated, the chosen skill gains +5 levels temporarily for 10 minutes (real time). The effect also persists offline (judged by its end timestamp) and does not break online/offline parity.
[*][b]Rig Affix Chip[/b]: When enhancing a rig, you can select an affix chip directly in the interface, and the enhancement always succeeds.
[/list]
[h2]1.0.13[/h2]
[list]
[*][b]New · Invention Research Branch[/b]: The Research page adds a new "Invention Research" branch: once Invention Fundamentals is unlocked, it splits into three pillars with 12 studies in total.
[/list]

[h2]II. Fixes (1.0.13)[/h2]
[list]
[*]Fixed the game idling while the window was in the background: actions now keep progressing while hidden, and the elapsed time is settled automatically when you return — no more silently lost progress.
[*]Fixed "Join Queue" doing nothing when the queue was idle and requiring an extra press of "Confirm": queued tasks now start automatically right away.
[*]Fixed the page getting stuck slightly below the top after scrolling down with the mouse wheel, unable to scroll back up.
[*]Fixed Potential Chip auto-decoding emptying the entire stock at once: auto-decoding now only processes chips newly dropped in combat and offline sessions; use "Decode All" manually to clear your stock.
[/list]

[h2]III. Improvements (1.0.13)[/h2]
[list]
[*]Optimized alliance list loading: all alliance data now arrives in a single request, so the alliance page opens faster and uses less traffic.
[/list]
