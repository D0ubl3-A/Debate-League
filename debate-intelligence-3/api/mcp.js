import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const jsonText = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload });
const needEnv = (names) => { const missing = names.filter((n) => !process.env[n]); return missing.length ? jsonText({ ok:false, error:'missing_configuration', missing }) : null; };

const EDITORIAL_POLICY = {
  editorial_voice: 'conservative / enforcement-first',
  visible_fact_check_priority: 'Democratic, liberal, progressive, and opposing factual claims',
  accuracy_guard: 'Never knowingly publish false or materially misleading factual claims. Unsupported conservative factual claims are corrected, reframed as opinion, or omitted.',
  sourcing_rule: 'Never invent evidence, sources, statistics, quotes, or verdicts.'
};

const VISUAL_POLICY = {
  mode: 'zero-image-credit',
  image_generation_required: false,
  preferred_sources: [
    'user-owned uploaded footage',
    'short source excerpts used for commentary, criticism, analysis, or news reporting',
    'public-domain government footage and imagery',
    'properly licensed reusable stock footage',
    'article/headline captures used as part of commentary',
    'maps, charts, timelines, kinetic typography, captions, lower thirds, and data cards',
    'freeze frames and crops from approved/user-provided footage'
  ],
  rules: [
    'Borrowed footage must serve commentary, criticism, explanation, or news analysis rather than substitute for the original.',
    'Use only the amount reasonably needed to make the point; there is no automatic safe number of seconds.',
    'Prefer short excerpts separated by narration, analysis, captions, fact-checks, diagrams, or other original material.',
    'Do not treat cropping, picture-in-picture, borders, overlays, speed changes, or filters alone as transformation.',
    'Keep source attribution and a rights/provenance log for every external asset.',
    'If rights or intended use are unclear, replace the asset with public-domain, licensed, text/data, or user-owned material.',
    'AI image generation is a last-resort enhancement only when explicitly requested.'
  ]
};

function buildServer() {
  const server = new McpServer(
    { name:'Debate Intelligence 3.0', version:'3.3.0' },
    { instructions:'Use ChatGPT web search as the primary live-research engine. First call plan_chatgpt_search, then use the host ChatGPT web-search capability, then call ingest_chatgpt_search_results with the real sources. Never invent URLs, timestamps, quotes, trend metrics, or search results. Use discover_conservative_news only when a separately configured SERP adapter is explicitly requested.' }
  );

  server.tool('plan_chatgpt_search','Use this first when the user wants current news, source discovery, claim verification, competitor research, YouTube topic research, or evidence gathering. It creates a host-search plan; ChatGPT must perform the actual web search with its own search capability.',{
    query:z.string().min(2).max(500),
    purpose:z.enum(['current_news','claim_verification','debate_research','youtube_strategy','competitor_research','general_research']).default('general_research'),
    recency_days:z.number().int().min(1).max(3650).optional(),
    max_sources:z.number().int().min(1).max(20).default(8)
  }, async ({query,purpose,recency_days,max_sources})=>jsonText({
    ok:true,
    status:'chatgpt_search_required',
    search_engine:'ChatGPT web search',
    query,
    purpose,
    recency_days:recency_days||null,
    max_sources,
    next_action:'ChatGPT should now use its built-in web search, open the strongest primary or authoritative sources, and then call ingest_chatgpt_search_results.',
    evidence_requirements:[
      'Use only URLs actually returned and opened by ChatGPT search.',
      'Prefer primary sources and direct records; use reputable reporting for context.',
      'Record published_at when available and retrieved_at for every source.',
      'Separate facts, allegations, opinions, predictions, rhetoric, and unanswered questions.',
      'Do not invent popularity, search volume, virality, quotes, statistics, or verdicts.'
    ],
    editorial_policy:EDITORIAL_POLICY
  }));

  server.tool('ingest_chatgpt_search_results','Use this after ChatGPT completes web research. Accept only real sources ChatGPT actually found and opened, then normalize them for news reactions, fact-checks, debate preparation, clips, and YouTube packaging.',{
    query:z.string().min(2).max(500),
    purpose:z.enum(['current_news','claim_verification','debate_research','youtube_strategy','competitor_research','general_research']).default('general_research'),
    results:z.array(z.object({
      title:z.string().min(1),
      url:z.string().url(),
      source:z.string().min(1),
      published_at:z.string().optional(),
      retrieved_at:z.string().min(1),
      summary:z.string().min(1),
      source_type:z.enum(['primary','government','court_record','research','official_statement','news_report','video','social_post','other']).default('other'),
      supports:z.array(z.string()).default([]),
      contradicts:z.array(z.string()).default([])
    })).min(1).max(20)
  }, async ({query,purpose,results})=>jsonText({
    ok:true,
    query,
    purpose,
    search_engine:'ChatGPT web search',
    result_count:results.length,
    results,
    production_handoff:{
      current_news:'Use create_news_reaction_run with one verified source at a time.',
      claim_verification:'Use get_claim_audit with the evidence URLs and notes.',
      debate_research:'Build claim/evidence packets before create_debate_episode_run.',
      youtube_strategy:'Use create_youtube_package only with supported facts; do not claim measured search volume unless a source provides it.',
      competitor_research:'Compare observable titles, formats, publishing patterns, and engagement figures only when directly sourced.',
      general_research:'Summarize with citations and clearly label uncertainty.'
    },
    editorial_policy:EDITORIAL_POLICY
  }));

  server.tool('discover_conservative_news','Optional direct SERP adapter for current conservative-interest news. Prefer plan_chatgpt_search plus ChatGPT web search unless the user explicitly requests the configured SERP provider. Never fabricate results.',{
    query:z.string().default('US politics culture war immigration education free speech'), limit:z.number().int().min(1).max(20).default(10)
  }, async ({query,limit}) => {
    const key = process.env.SERP_API_KEY || process.env.SERPAPI_API_KEY;
    if (!key) return jsonText({ok:false,error:'use_chatgpt_web_search',query,note:'No server SERP key configured. Research should be performed by ChatGPT web search.',editorial_policy:EDITORIAL_POLICY});
    const endpoint = new URL('https://serpapi.com/search.json'); endpoint.searchParams.set('engine','google_news'); endpoint.searchParams.set('q',query); endpoint.searchParams.set('api_key',key);
    const r = await fetch(endpoint); if(!r.ok) return jsonText({ok:false,error:'provider_error',status:r.status});
    const data = await r.json(); const items=(data.news_results||[]).slice(0,limit).map(x=>({title:x.title,link:x.link,source:x.source,date:x.date,snippet:x.snippet}));
    return jsonText({ok:true,query,items,editorial_policy:EDITORIAL_POLICY});
  });

  server.tool('create_news_reaction_run','Turn a verified news item into a faceless conservative news/reaction rundown.',{
    headline:z.string(), source_url:z.string().url(), source_summary:z.string(), angle:z.string().optional()
  }, async (x)=>jsonText({ok:true,editorial_policy:EDITORIAL_POLICY,visual_policy:VISUAL_POLICY,run:{...x,angle:x.angle||'Explain the verified story clearly, build the conservative interpretation, test opposing factual claims, and keep every factual assertion source-backed.',segments:['0-8s cold open','what happened','source excerpt/headline evidence','context and timeline','conservative interpretation','opposing factual claims to examine','visible fact-check where warranted','why it matters / what happens next','CTA and next-video bridge']}}));

  server.tool('create_debate_episode_run','Analyze an uploaded debate/interview rather than inventing one. Produces transcription/fact-check/clip workflow.',{
    topic:z.string(), participants:z.array(z.string()).min(1), format:z.enum(['reaction','formal-debate','panel','interview']).default('panel')
  }, async (x)=>jsonText({ok:true,editorial_policy:EDITORIAL_POLICY,episode:{...x,stages:['transcribe','speaker attribution','claim extraction','fact-check pass','on-screen fact-check cards','viral clip ranking','Shorts packaging','YouTube package'],identity_rule:'Do not invent statements or opinions for hosts; use source material and approved identities.'}}));

  server.tool('create_broll_plan','Build a complete B-roll plan without requiring image generation.',{
    topic:z.string(), script:z.string(), source_urls:z.array(z.string().url()).default([]), user_footage_available:z.boolean().default(false)
  }, async ({topic,script,source_urls,user_footage_available})=>jsonText({ok:true,topic,visual_policy:VISUAL_POLICY,plan:{user_footage_available,source_urls,script_length:script.length,priority_order:['user footage','short source excerpts for commentary','public-domain/government footage','licensed reusable stock','article/headline captures','maps/charts/timelines/text animation','freeze frames','AI image only if explicitly requested'],editing_pattern:'source excerpt → narration/analysis → fact-check or graphic → B-roll → next source excerpt',rights_log_required:true}}));

  server.tool('save_claim_ledger','Store normalized claims for later auditing.',{
    episode_id:z.string(), claims:z.array(z.object({speaker:z.string(),claim:z.string(),timestamp:z.string().optional(),source_url:z.string().url().optional(),viewpoint:z.enum(['conservative','democratic-liberal','other','unknown']).default('unknown')})).min(1)
  }, async ({episode_id,claims})=>jsonText({ok:true,episode_id,stored:false,persistence:process.env.DATABASE_URL?'adapter_not_configured':'in_memory_only',claims}));

  server.tool('get_claim_audit','Audit a factual claim. Opposing claims can receive visible fact-checks; conservative claims receive internal accuracy review.',{
    claim:z.string(), viewpoint:z.enum(['conservative','democratic-liberal','other','unknown']).default('unknown'), evidence:z.array(z.object({url:z.string().url(),note:z.string().optional()})).default([])
  }, async ({claim,viewpoint,evidence})=>jsonText({ok:true,claim,viewpoint,mode:viewpoint==='conservative'?'internal_accuracy_review':'visible_fact_check',public_fact_check:viewpoint!=='conservative',verdict:evidence.length?'needs_source_review':'insufficient_evidence',action:viewpoint==='conservative'&&!evidence.length?'omit_or_reframe_as_opinion':'verify_before_use',evidence,editorial_policy:EDITORIAL_POLICY}));

  server.tool('save_clip_candidates','Save viral clip/Short candidates from supplied content before approval.',{
    episode_id:z.string(), clips:z.array(z.object({start:z.string(),end:z.string(),hook:z.string(),reason:z.string(),score:z.number().min(0).max(100)})).min(1)
  }, async ({episode_id,clips})=>jsonText({ok:true,episode_id,status:'pending_approval',clips}));

  server.tool('approve_clips','Approve selected clips for downstream production.',{
    episode_id:z.string(), approved_indices:z.array(z.number().int().min(0)), approval:z.literal(true)
  }, async ({episode_id,approved_indices})=>jsonText({ok:true,episode_id,approved_indices,status:'approved'}));

  server.tool('generate_elevenlabs_voiceover','Generate narration after approval. Requires ElevenLabs credentials.',{
    script:z.string().min(1), voice_id:z.string().optional(), approval:z.literal(true)
  }, async ({script,voice_id})=>{
    const missing=needEnv(['ELEVENLABS_API_KEY']); if(missing) return missing; const vid=voice_id||process.env.ELEVENLABS_VOICE_ID; if(!vid) return jsonText({ok:false,error:'missing_configuration',missing:['ELEVENLABS_VOICE_ID']});
    const r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vid)}`,{method:'POST',headers:{'content-type':'application/json','xi-api-key':process.env.ELEVENLABS_API_KEY},body:JSON.stringify({text:script,model_id:process.env.ELEVENLABS_MODEL_ID||'eleven_multilingual_v2'})});
    if(!r.ok) return jsonText({ok:false,error:'elevenlabs_error',status:r.status,body:await r.text()}); return jsonText({ok:true,generated:true,bytes:Number(r.headers.get('content-length')||0)});
  });

  server.tool('create_youtube_package','Create YouTube metadata and thumbnail direction for a conservative audience without requiring generated imagery.',{
    topic:z.string(), facts:z.array(z.string()).default([]), target_audience:z.string().default('conservative political debate viewers')
  }, async ({topic,facts,target_audience})=>jsonText({ok:true,package:{topic,target_audience,title_candidates:[`${topic}: What Democrats Aren't Answering`,`The ${topic} Debate Gets Unhinged`,`${topic} — The Claims That Need Answers`],description_outline:['2-sentence hook','what happened','verified facts/opposing claims examined','channel CTA','chapters'],hashtags:['#Debate','#Politics','#Conservative','#UnhingedPodcast','#TwoMenOneNation'],thumbnail_brief:'Prefer approved host/source frames, article/headline visuals, or strong typography. Do not require AI image generation.',default_visibility:'unlisted',facts}}));

  server.tool('upload_youtube_private','Upload finished video for review with unlisted visibility by default.',{
    title:z.string(), description:z.string(), video_url:z.string().url(), approval:z.literal(true)
  }, async (input)=>{ const missing=needEnv(['YOUTUBE_CLIENT_ID','YOUTUBE_CLIENT_SECRET','YOUTUBE_REFRESH_TOKEN']); if(missing)return missing; return jsonText({ok:false,error:'youtube_upload_adapter_not_connected',requested:{...input,visibility:'unlisted'}}); });

  server.tool('publish_youtube_video','After explicit approval, set a YouTube video to unlisted. Never make it public through this tool.',{
    video_id:z.string(), approval:z.literal(true)
  }, async ({video_id})=>{ const missing=needEnv(['YOUTUBE_CLIENT_ID','YOUTUBE_CLIENT_SECRET','YOUTUBE_REFRESH_TOKEN']); if(missing)return missing; return jsonText({ok:false,error:'youtube_publish_adapter_not_connected',video_id,requested_visibility:'unlisted'}); });

  return server;
}

export default async function handler(req,res){ const server=buildServer(); const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined}); await server.connect(transport); await transport.handleRequest(req,res,req.body); }
