# Learned from

The ideas in this desk that I took from someone else, where I found them, and where they live here.
Every source is public, and each one was checked against its original post or page.

| Idea | Source | Date | Where it lives here |
|---|---|---|---|
| Give the AI a way to check its own work. It makes the result much better. | Boris Cherny, [post](https://x.com/bcherny/status/2007179832300581177) | Jan 2, 2026 | `src/checkreply.mjs`, the script checker every reply goes through |
| Use a separate, fresh reviewer that tries to refute the result, instead of letting the writer grade itself. | Anthropic, [Claude Code best practices](https://code.claude.com/docs/en/best-practices) | read Sep 27, 2026 | `.claude/agents/reply-checker.md`, which sees only the packet |
| If you do something more than once a day, turn it into a skill. | Boris Cherny, [post](https://x.com/bcherny/status/2017742741636321619) | Jan 31, 2026 | `.claude/skills/support-desk/SKILL.md` |
| After every correction, write the rule down so the same mistake does not happen again. | Boris Cherny, [same post](https://x.com/bcherny/status/2017742741636321619) | Jan 31, 2026 | `desk/known-failures.md`, checked first on every ticket |
| Custom subagents live as files in `.claude/agents`. | Boris Cherny, [post](https://x.com/bcherny/status/2021699851499798911); [Claude Code subagents docs](https://code.claude.com/docs/en/sub-agents) | Feb 11, 2026 | `.claude/agents/` |
| Share the team's MCP servers in a checked-in `.mcp.json`. | Boris Cherny, [post](https://x.com/bcherny/status/2007179832300581177) | Jan 2, 2026 | `.mcp.json` (Blotato's docs server, which needs no key) |
| Daily runs should check their own work end to end, and a person reviews before anything goes out. | Boris Cherny, [post](https://x.com/bcherny/status/2088014489438621990) | Aug 13, 2026 | `scheduled/`, and the `cleared` send gate |
| An AI stops when it feels done, not when it is right, so "done" needs a check. | Sabrina Ramonov, [post](https://x.com/Sabrina_Ramonov/status/2081092120891261137) | Jul 25, 2026 | The rule that no reply is sent until the fresh checker passes that exact text |
| A support answer has four parts: the answer, the next supported action, what proves success or what is still open, and a link. | Blotato help center, [Diagnose a support question](https://help.blotato.com/start-with-an-ai-agent/agent-triage) | read Nov 15, 2026 | The reply shape in `src/diagnose.mjs`, enforced in `src/checkreply.mjs` |
| "Unknown outcome is not permission to create again." | Blotato help center, [Diagnose a support question](https://help.blotato.com/start-with-an-ai-agent/agent-triage) | read Nov 15, 2026 | Tickets T09 and T10, and the practice shift |

What is my own: the practice shift, "Your first support shift", made from the same playbook.
I build learning games, and I would rather people practice a decision than read about it.
