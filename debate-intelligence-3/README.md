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

1. `discover_conservative_news` — source-backed Google News discovery through SerpAPI.
2. `create_news_reaction_run` — converts a sourced story into a debate/reaction rundown.
3. `create_debate_episode_run` — builds episode rounds and host cross-examination prompts.
4. `save_claim_ledger` — normalizes claims for an episode.
5. `get_claim_audit` — prepares a source/evidence-first fact-check record without inventing a verdict.
6. `save_clip_candidates` — saves scored viral-clip candidates as pending approval.
7. `approve_clips` — explicit human approval gate for selected clips.
8. `generate_elevenlabs_voiceover` — ElevenLabs TTS after approval.
9. `create_youtube_package` — titles, description outline, hashtags and thumbnail brief.
10. `upload_youtube_private` — gated private-upload integration point.
11. `publish_youtube_video` — explicit approval gate for public publishing.

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

- News must come from returned source URLs; do not invent stories.
- Claim audits should remain `insufficient_evidence` or `needs_human_or_model_review` until evidence is checked.
- Voiceover requires `approval: true`.
- Clip approval requires `approval: true`.
- Private YouTube upload requires `approval: true`.
- Public YouTube publishing requires `approval: true` and a configured OAuth adapter.
