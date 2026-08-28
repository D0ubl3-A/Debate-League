# Debate Intelligence 3.0

**Powered by iLLCoAi.Tech**  
Built for **Two Men One Nation | The Unhinged Podcast**.

This folder contains a public MCP server implementation for debate intelligence and podcast production workflows.

## Endpoint

When this folder is deployed as the project root on Vercel, the MCP endpoint is:

```text
/api/mcp
```

For the intended public deployment:

```text
https://unhinged-podcast-mcp.viraldebates.chatgpt.site/api/mcp
```

## Tool surface

1. `plan_chatgpt_search` — prepares current-news, claim-verification, debate, competitor, YouTube, or general research for ChatGPT's built-in web search.
2. `ingest_chatgpt_search_results` — accepts only real sources ChatGPT found and opened, preserves citations and timestamps, and routes grounded findings into production.
3. `discover_conservative_news` — optional source-backed Google News discovery through SerpAPI when explicitly requested and configured.
4. `create_news_reaction_run` — converts a sourced story into a debate/reaction rundown.
5. `create_debate_episode_run` — builds episode rounds and host cross-examination prompts.
6. `save_claim_ledger` — normalizes claims for an episode.
7. `get_claim_audit` — prepares a source/evidence-first fact-check record without inventing a verdict.
8. `save_clip_candidates` — saves scored viral-clip candidates as pending approval.
9. `approve_clips` — explicit human approval gate for selected clips.
10. `generate_elevenlabs_voiceover` — ElevenLabs TTS after approval.
11. `create_youtube_package` — titles, description outline, hashtags and thumbnail brief.
12. `upload_youtube_private` — gated private-upload integration point.
13. `publish_youtube_video` — explicit approval gate for publishing.

## Configuration

Create environment variables from `.env.example`.

The MCP server boots without secrets. Integration tools return structured `missing_configuration` errors when the required credential is absent. This is intentional: the server never fabricates news results, audio generation, uploads, or publication.

## Deploy

Use this folder as the deployment root. Install dependencies and deploy to a Node 20+ Vercel project.

```bash
npm install
vercel --prod
```

Then configure the public hostname to route to that deployment and smoke-test `/api/mcp` with MCP `initialize`, `tools/list`, and a harmless read-only tool call before enabling production credentials.

## Production gates

- Live research should use `plan_chatgpt_search`, ChatGPT web search, and `ingest_chatgpt_search_results` in that order.
- News must come from URLs ChatGPT actually found and opened, or from the configured SERP adapter; do not invent stories.
- Claim audits should remain `insufficient_evidence` or `needs_human_or_model_review` until evidence is checked.
- Voiceover requires `approval: true`.
- Clip approval requires `approval: true`.
- Private YouTube upload requires `approval: true`.
- Public YouTube publishing requires `approval: true` and a configured OAuth adapter.
