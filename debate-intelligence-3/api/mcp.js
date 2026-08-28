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

const EDITORIAL_POLICY = {
  editorial_voice: 'conservative / enforcement-first',
  visible_fact_check_priority: 'Democratic, liberal, progressive, and opposing factual claims',
  conservative_claim_handling: [
    'Do not knowingly publish false or materially misleading conservative factual claims.',
    'Verify important conservative factual claims internally before use.',
    'If a conservative factual claim cannot be supported, silently correct it, reframe it as opinion, or omit it.',
    'Do not create a public-facing fact-check segment attacking the conservative position unless accuracy requires a correction to avoid misleading the audience.',
  ],
  opinion_rule: 'Clearly distinguish opinion, value judgment, prediction, and factual claim.',
  sourcing_rule: 'Do not invent evidence, sources, statistics, quotes, or verdicts.',
};

function buildServer() {
  const server = new McpServer({
    name: 'Debate Intelligence 3.0',
    version: '3.1.0',
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
      return jsonText({ ok: true, query, items, editorial_policy: EDITORIAL_POLICY });
    },
  );

  server.tool(
    'create_news_reaction_run',
    'Use this when turning a verified news item into a conservative podcast debate/reaction rundown. Visible fact-check pressure should focus on Democratic/liberal/opposing factual claims. Unsupported conservative factual claims should be corrected, reframed as opinion, or omitted rather than amplified.',
    {
      headline: z.string(),
      source_url: z.string().url(),
      source_summary: z.string(),
      angle: z.string().optional(),
    },
    async ({ headline, source_url, source_summary, angle }) => jsonText({
      ok: true,
      editorial_policy: EDITORIAL_POLICY,
      run: {
        headline,
        source_url,
        source_summary,
        angle: angle || 'Build the strongest conservative case, identify the strongest opposing claims, and aggressively test factual claims made by Democratic/liberal/progressive sources or participants.',
        segments: [
          'Cold open / why this matters from a conservative perspective',
          'Verified facts from the source',
          'Strongest conservative case',
          'Democratic/liberal claims to challenge',
          'Visible fact-check of opposing factual claims',
          'Host cross-examination prompts',
          'Clip-worthy closing question',
        ],
        internal_accuracy_pass: [
          'Check important conservative factual claims before use.',
          'Silently correct unsupported wording.',
          'Convert subjective claims to clearly labeled opinion when appropriate.',
          'Omit claims that cannot be responsibly supported.',
        ],
      },
    }),
  );

  server.tool(
    'create_debate_episode_run',
    'Use this when planning a full Two Men One Nation / Unhinged Podcast debate episode. The editorial framing is conservative, with visible fact-check emphasis on Democratic/liberal/opposing factual claims while maintaining an internal accuracy check for all factual content.',
    {
      topic: z.string(),
      participants: z.array(z.string()).min(1),
      format: z.enum(['reaction', 'formal-debate', 'panel', 'interview']).default('panel'),
    },
    async ({ topic, participants, format }) => jsonText({
      ok: true,
      editorial_policy: EDITORIAL_POLICY,
      episode: {
        topic, participants, format,
        rounds: [
          'Opening positions',
          'Conservative case',
          'Opposing evidence round',
          'Cross-examination',
          'Visible fact-check of Democratic/liberal/opposing factual claims',
          'Rebuttals',
          'Closing arguments',
        ],
        host_prompts: [
          'What primary source supports that claim?',
          'Is that a factual claim, prediction, or opinion?',
          'What evidence contradicts the Democratic/liberal version of this claim?',
          'What fact would change the opposing side’s conclusion?',
        ],
        internal_accuracy_pass: EDITORIAL_POLICY.conservative_claim_handling,
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
        viewpoint: z.enum(['conservative', 'democratic-liberal', 'other', 'unknown']).default('unknown'),
      })).min(1),
    },
    async ({ episode_id, claims }) => jsonText({ ok: true, episode_id, stored: false, persistence: process.env.DATABASE_URL ? 'adapter_not_configured' : 'in_memory_only', editorial_policy: EDITORIAL_POLICY, claims }),
  );

  server.tool(
    'get_claim_audit',
    'Use this when auditing a factual claim. Democratic/liberal/opposing factual claims are eligible for visible fact-check output. Conservative factual claims receive an internal accuracy review and should be corrected, reframed, or omitted if unsupported rather than turned into a promotional falsehood.',
    {
      claim: z.string(),
      viewpoint: z.enum(['conservative', 'democratic-liberal', 'other', 'unknown']).default('unknown'),
      evidence: z.array(z.object({ url: z.string().url(), note: z.string().optional() })).default([]),
    },
    async ({ claim, viewpoint, evidence }) => {
      const supported = evidence.length > 0;
      if (viewpoint === 'conservative') {
        return jsonText({
          ok: true,
          claim,
          viewpoint,
          mode: 'internal_accuracy_review',
          public_fact_check: false,
          verdict: supported ? 'needs_source_review_before_use' : 'unsupported_do_not_publish_as_fact',
          action: supported ? 'verify_then_use_or_rephrase' : 'omit_or_reframe_as_opinion',
          evidence,
          editorial_policy: EDITORIAL_POLICY,
        });
      }
      return jsonText({
        ok: true,
        claim,
        viewpoint,
        mode: 'visible_fact_check',
        public_fact_check: true,
        verdict: supported ? 'needs_human_or_model_review' : 'insufficient_evidence',
        evidence,
        rule: 'Do not label true/false without source-backed review.',
        editorial_policy: EDITORIAL_POLICY,
      });
    },
  );

  server.tool(
    'save_clip_candidates',
    'Use this when saving candidate viral clips from a debate before approval. Clip packaging may favor the conservative editorial angle but must not fabricate or materially distort factual content.',
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
    async ({ episode_id, clips }) => jsonText({ ok: true, episode_id, status: 'pending_approval', editorial_policy: EDITORIAL_POLICY, clips }),
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
    'Use this when creating the complete YouTube publishing package. Optimize the framing for a conservative audience while keeping titles, descriptions, thumbnails, and hooks factually supportable.',
    {
      topic: z.string(),
      facts: z.array(z.string()).default([]),
      target_audience: z.string().default('conservative political debate viewers'),
    },
    async ({ topic, facts, target_audience }) => jsonText({
      ok: true,
      editorial_policy: EDITORIAL_POLICY,
      package: {
        topic,
        target_audience,
        title_candidates: [
          `${topic}: What Democrats Aren't Answering`,
          `The ${topic} Debate Gets Unhinged`,
          `${topic} — The Claims That Need Answers`,
        ],
        description_outline: ['2-sentence conservative hook', 'what was debated', 'verified facts and opposing claims examined', 'channel CTA', 'chapters when available'],
        hashtags: ['#Debate', '#Politics', '#Conservative', '#UnhingedPodcast', '#TwoMenOneNation'],
        thumbnail_brief: 'Two-host confrontation composition; 3–5 word tension phrase; one recognizable topic visual; high facial emotion; do not use misleading evidence imagery.',
        facts,
        accuracy_guard: 'Unsupported conservative factual claims must be corrected, reframed as opinion, or omitted before packaging.',
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
