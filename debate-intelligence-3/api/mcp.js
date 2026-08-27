import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const jsonText = (payload) => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  structuredContent: payload,
});

const needEnv = (names) => {
  const missing = names.filter((n) => !process.env[n]);
  if (!missing.length) return null;
  return jsonText({ ok: false, error: 'missing_configuration', missing });
};

function buildServer() {
  const server = new McpServer({
    name: 'Debate Intelligence 3.0',
    version: '3.0.0',
  });

  server.tool(
    'discover_conservative_news',
    'Use this when you need current controversial or high-engagement news topics relevant to a conservative debate show. Returns source-backed candidates only when a configured news/search provider is available.',
    {
      query: z.string().default('US politics culture war immigration education free speech'),
      limit: z.number().int().min(1).max(20).default(10),
    },
    async ({ query, limit }) => {
      const key = process.env.SERP_API_KEY || process.env.SERPAPI_API_KEY;
      if (!key) return needEnv(['SERP_API_KEY']);
      const endpoint = new URL('https://serpapi.com/search.json');
      endpoint.searchParams.set('engine', 'google_news');
      endpoint.searchParams.set('q', query);
      endpoint.searchParams.set('api_key', key);
      const r = await fetch(endpoint);
      if (!r.ok) return jsonText({ ok: false, error: 'provider_error', status: r.status });
      const data = await r.json();
      const items = (data.news_results || []).slice(0, limit).map((x) => ({
        title: x.title,
        link: x.link,
        source: x.source,
        date: x.date,
        snippet: x.snippet,
      }));
      return jsonText({ ok: true, query, items });
    },
  );

  server.tool(
    'create_news_reaction_run',
    'Use this when turning a verified news item into a podcast debate/reaction rundown. This creates a structured editorial run but does not publish anything.',
    {
      headline: z.string(),
      source_url: z.string().url(),
      source_summary: z.string(),
      angle: z.string().optional(),
    },
    async ({ headline, source_url, source_summary, angle }) => jsonText({
      ok: true,
      run: {
        headline,
        source_url,
        source_summary,
        angle: angle || 'What is the strongest argument on each side, what facts are disputed, and what should the hosts challenge?',
        segments: [
          'Cold open / why this matters',
          'Verified facts from the source',
          'Strongest conservative case',
          'Strongest opposing case',
          'Claims requiring live fact-check',
          'Host cross-examination prompts',
          'Clip-worthy closing question',
        ],
      },
    }),
  );

  server.tool(
    'create_debate_episode_run',
    'Use this when planning a full Two Men One Nation / Unhinged Podcast debate episode from a topic and participants.',
    {
      topic: z.string(),
      participants: z.array(z.string()).min(1),
      format: z.enum(['reaction', 'formal-debate', 'panel', 'interview']).default('panel'),
    },
    async ({ topic, participants, format }) => jsonText({
      ok: true,
      episode: {
        topic, participants, format,
        rounds: ['Opening positions', 'Evidence round', 'Cross-examination', 'Rebuttals', 'Fact-check break', 'Closing arguments'],
        host_prompts: [
          'What evidence would change your mind?',
          'Which part of the opposing argument is strongest?',
          'Is that a factual claim, prediction, or opinion?',
          'What primary source supports that?',
        ],
      },
    }),
  );

  server.tool(
    'save_claim_ledger',
    'Use this when storing claims from an episode for later auditing. The default implementation returns a normalized ledger payload; persistent storage can be connected with DATABASE_URL.',
    {
      episode_id: z.string(),
      claims: z.array(z.object({
        speaker: z.string(),
        claim: z.string(),
        timestamp: z.string().optional(),
        source_url: z.string().url().optional(),
      })).min(1),
    },
    async ({ episode_id, claims }) => jsonText({ ok: true, episode_id, stored: false, persistence: process.env.DATABASE_URL ? 'adapter_not_configured' : 'in_memory_only', claims }),
  );

  server.tool(
    'get_claim_audit',
    'Use this when auditing a factual claim. It separates verdict, evidence, uncertainty, and source requirements rather than inventing a fact-check.',
    {
      claim: z.string(),
      evidence: z.array(z.object({ url: z.string().url(), note: z.string().optional() })).default([]),
    },
    async ({ claim, evidence }) => jsonText({
      ok: true,
      claim,
      verdict: evidence.length ? 'needs_human_or_model_review' : 'insufficient_evidence',
      evidence,
      rule: 'Do not label true/false without source-backed review.',
    }),
  );

  server.tool(
    'save_clip_candidates',
    'Use this when saving candidate viral clips from a debate before approval.',
    {
      episode_id: z.string(),
      clips: z.array(z.object({
        start: z.string(),
        end: z.string(),
        hook: z.string(),
        reason: z.string(),
        score: z.number().min(0).max(100),
      })).min(1),
    },
    async ({ episode_id, clips }) => jsonText({ ok: true, episode_id, status: 'pending_approval', clips }),
  );

  server.tool(
    'approve_clips',
    'Use this when a human explicitly approves selected clip IDs/candidates for downstream production.',
    {
      episode_id: z.string(),
      approved_indices: z.array(z.number().int().min(0)),
      approval: z.literal(true),
    },
    async ({ episode_id, approved_indices }) => jsonText({ ok: true, episode_id, approved_indices, status: 'approved' }),
  );

  server.tool(
    'generate_elevenlabs_voiceover',
    'Use this when generating a voiceover after script approval. Requires ELEVENLABS_API_KEY and a voice ID.',
    {
      script: z.string().min(1),
      voice_id: z.string().optional(),
      approval: z.literal(true),
    },
    async ({ script, voice_id }) => {
      const missing = needEnv(['ELEVENLABS_API_KEY']);
      if (missing) return missing;
      const vid = voice_id || process.env.ELEVENLABS_VOICE_ID;
      if (!vid) return jsonText({ ok: false, error: 'missing_configuration', missing: ['ELEVENLABS_VOICE_ID'] });
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vid)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY },
        body: JSON.stringify({ text: script, model_id: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2' }),
      });
      if (!r.ok) return jsonText({ ok: false, error: 'elevenlabs_error', status: r.status, body: await r.text() });
      return jsonText({ ok: true, generated: true, bytes: Number(r.headers.get('content-length') || 0), note: 'Audio streaming/storage adapter should be connected by deployment host.' });
    },
  );

  server.tool(
    'create_youtube_package',
    'Use this when creating the complete YouTube publishing package: title candidates, description, hashtags, tags, thumbnail brief, hook, and pinned-comment idea.',
    {
      topic: z.string(),
      facts: z.array(z.string()).default([]),
      target_audience: z.string().default('political debate viewers'),
    },
    async ({ topic, facts, target_audience }) => jsonText({
      ok: true,
      package: {
        topic,
        target_audience,
        title_candidates: [
          `${topic}: The Argument Nobody Is Answering`,
          `The ${topic} Debate Gets Unhinged`,
          `${topic} — Facts, Claims & the Fight Behind It`,
        ],
        description_outline: ['2-sentence hook', 'what was debated', 'verified sources/facts', 'channel CTA', 'chapters when available'],
        hashtags: ['#Debate', '#Politics', '#UnhingedPodcast', '#TwoMenOneNation'],
        thumbnail_brief: 'Two-host confrontation composition; 3–5 word tension phrase; one recognizable topic visual; high facial emotion; no misleading evidence imagery.',
        facts,
      },
    }),
  );

  server.tool(
    'upload_youtube_private',
    'Use this when uploading a finished video privately for review. Requires a configured YouTube OAuth adapter; this server will not fake a successful upload.',
    {
      title: z.string(),
      description: z.string(),
      video_url: z.string().url(),
      approval: z.literal(true),
    },
    async (input) => {
      const missing = needEnv(['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN']);
      if (missing) return missing;
      return jsonText({ ok: false, error: 'youtube_upload_adapter_not_connected', requested: { ...input, visibility: 'private' } });
    },
  );

  server.tool(
    'publish_youtube_video',
    'Use this only after explicit human approval to change a previously uploaded private YouTube video to public. Never call without approval=true.',
    {
      video_id: z.string(),
      approval: z.literal(true),
    },
    async ({ video_id }) => {
      const missing = needEnv(['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN']);
      if (missing) return missing;
      return jsonText({ ok: false, error: 'youtube_publish_adapter_not_connected', video_id });
    },
  );

  return server;
}

export default async function handler(req, res) {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
