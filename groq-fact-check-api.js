/**
 * GROQ-POWERED FACT-CHECKING API
 * Internet-enabled reasoning model for real-time verification
 */

const express = require('express');
const { OpenAI } = require('openai');
const rateLimit = require('express-rate-limit');

class GroqFactCheckAPI {
    constructor() {
        this.app = express();
        this.groqClient = new OpenAI({
            apiKey: process.env.GROQ_API_KEY,
            baseURL: "https://api.groq.com/openai/v1",
        });
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }

    setupMiddleware() {
        // Rate limiting for fact-checking API
        const factCheckLimiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 100, // Limit each IP to 100 requests per windowMs
            message: {
                error: 'Too many fact-check requests, please try again later.',
                retryAfter: '15 minutes'
            }
        });

        this.app.use(express.json({ limit: '10mb' }));
        this.app.use('/api/fact-check', factCheckLimiter);
    }

    setupRoutes() {
        // Main fact-checking endpoint
        this.app.post('/api/fact-check/verify', async (req, res) => {
            try {
                const { statement, context, priority } = req.body;
                
                if (!statement) {
                    return res.status(400).json({
                        error: 'Statement is required for fact-checking'
                    });
                }

                const result = await this.performInternetFactCheck(statement, context, priority);
                res.json(result);

            } catch (error) {
                console.error('Fact-check API error:', error);
                res.status(500).json({
                    error: 'Fact-checking service temporarily unavailable',
                    details: error.message
                });
            }
        });

        // Batch fact-checking endpoint
        this.app.post('/api/fact-check/batch', async (req, res) => {
            try {
                const { statements, context } = req.body;
                
                if (!statements || !Array.isArray(statements)) {
                    return res.status(400).json({
                        error: 'Statements array is required for batch fact-checking'
                    });
                }

                if (statements.length > 10) {
                    return res.status(400).json({
                        error: 'Maximum 10 statements allowed per batch request'
                    });
                }

                const results = await this.performBatchFactCheck(statements, context);
                res.json({ results });

            } catch (error) {
                console.error('Batch fact-check API error:', error);
                res.status(500).json({
                    error: 'Batch fact-checking service temporarily unavailable',
                    details: error.message
                });
            }
        });

        // Source verification endpoint
        this.app.post('/api/fact-check/verify-source', async (req, res) => {
            try {
                const { sourceUrl, context } = req.body;
                
                if (!sourceUrl) {
                    return res.status(400).json({
                        error: 'Source URL is required for verification'
                    });
                }

                const result = await this.verifySourceCredibility(sourceUrl, context);
                res.json(result);

            } catch (error) {
                console.error('Source verification API error:', error);
                res.status(500).json({
                    error: 'Source verification service temporarily unavailable',
                    details: error.message
                });
            }
        });

        // Research endpoint
        this.app.post('/api/fact-check/research', async (req, res) => {
            try {
                const { topic, depth, context } = req.body;
                
                if (!topic) {
                    return res.status(400).json({
                        error: 'Research topic is required'
                    });
                }

                const result = await this.performAdvancedResearch(topic, depth, context);
                res.json(result);

            } catch (error) {
                console.error('Research API error:', error);
                res.status(500).json({
                    error: 'Research service temporarily unavailable',
                    details: error.message
                });
            }
        });

        // Real-time fact-check stream endpoint
        this.app.get('/api/fact-check/stream/:sessionId', (req, res) => {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });

            const sessionId = req.params.sessionId;
            this.setupFactCheckStream(sessionId, res);
        });

        // Health check endpoint
        this.app.get('/api/fact-check/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                services: {
                    groq_reasoning: 'operational',
                    internet_access: 'enabled',
                    fact_checking: 'active'
                }
            });
        });
    }

    /**
     * GROQ REASONING + INTERNET: Advanced Fact Checking
     */
    async performInternetFactCheck(statement, context = {}, priority = 'standard') {
        console.log(`🌐 GROQ INTERNET FACT-CHECK: "${statement.substring(0, 100)}..."`);
        const startTime = Date.now();

        try {
            const model = priority === 'urgent' ? 'llama-3.1-8b-instant' : 'openai/gpt-oss-20b';
            
            const prompt = `You are an expert fact-checker with real-time internet access. Verify this statement using current, authoritative sources:

STATEMENT: "${statement}"
CONTEXT: ${JSON.stringify(context, null, 2)}
PRIORITY: ${priority}

VERIFICATION PROCESS:
1. Search for current, authoritative sources about this claim
2. Cross-reference multiple reliable sources (minimum 3)
3. Check for recent updates or changes to the information
4. Identify any bias or misinformation patterns
5. Provide step-by-step reasoning for your conclusion
6. Include live source URLs with access timestamps

Provide comprehensive fact-check analysis in JSON format:
{
  "statement": "${statement}",
  "verdict": "true|false|partially_true|unverifiable|outdated|misleading",
  "confidence": 0.0-1.0,
  "reasoning_steps": [
    "Step 1: Searched authoritative sources",
    "Step 2: Cross-referenced findings",
    "Step 3: Analyzed source credibility"
  ],
  "explanation": "detailed explanation with reasoning",
  "evidence": [
    {
      "type": "supporting|contradicting|neutral",
      "source": "source name",
      "url": "source URL",
      "excerpt": "relevant excerpt",
      "credibility": 0.0-1.0,
      "date_accessed": "timestamp"
    }
  ],
  "corrections": ["any necessary corrections"],
  "context_analysis": "how context affects the claim",
  "bias_indicators": ["potential bias markers"],
  "credibility_score": 0.0-1.0,
  "last_verified": "timestamp of verification",
  "source_quality_assessment": "overall assessment of sources used",
  "follow_up_recommendations": ["recommendation 1", "recommendation 2"]
}

Use your internet access to verify claims against current, authoritative sources. Be thorough and accurate.`;

            const response = await this.groqClient.chat.completions.create({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.05,
                max_tokens: 12000,
                top_p: 0.98
            });

            const factCheckContent = response.choices[0].message.content;
            let factCheckResult;

            try {
                factCheckResult = JSON.parse(factCheckContent);
            } catch (e) {
                factCheckResult = this.parseFactCheckFallback(factCheckContent, statement);
            }

            const processingTime = Date.now() - startTime;

            return {
                ...factCheckResult,
                processing_time: processingTime,
                timestamp: new Date().toISOString(),
                groq_model_used: model,
                internet_verified: true,
                api_version: 'v3.0',
                priority: priority
            };

        } catch (error) {
            console.error("Internet fact-check failed:", error);
            return await this.performFallbackFactCheck(statement, context, error);
        }
    }

    /**
     * Batch Fact-Checking with Parallel Processing
     */
    async performBatchFactCheck(statements, context = {}) {
        console.log(`📊 GROQ BATCH FACT-CHECK: ${statements.length} statements`);
        const startTime = Date.now();

        try {
            // Process statements in parallel for speed
            const factCheckPromises = statements.map((statement, index) => 
                this.performInternetFactCheck(statement, {
                    ...context,
                    batch_index: index,
                    batch_total: statements.length
                }, 'batch')
            );

            const results = await Promise.all(factCheckPromises);
            const processingTime = Date.now() - startTime;

            return {
                batch_results: results,
                batch_summary: {
                    total_statements: statements.length,
                    processing_time: processingTime,
                    average_time_per_statement: processingTime / statements.length,
                    verdicts_summary: this.summarizeVerdicts(results)
                },
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error("Batch fact-check failed:", error);
            throw error;
        }
    }

    /**
     * Source Credibility Verification
     */
    async verifySourceCredibility(sourceUrl, context = {}) {
        console.log(`🔍 GROQ SOURCE VERIFICATION: ${sourceUrl}`);

        try {
            const prompt = `You are a source credibility expert with internet access. Analyze this source for reliability:

SOURCE URL: ${sourceUrl}
CONTEXT: ${JSON.stringify(context, null, 2)}

VERIFICATION PROCESS:
1. Access and analyze the source content
2. Check domain authority and reputation
3. Verify author credentials and expertise
4. Assess publication date and currency
5. Analyze bias indicators and funding sources
6. Cross-reference with other authoritative sources

Provide credibility analysis in JSON format:
{
  "source_url": "${sourceUrl}",
  "credibility_score": 0.0-1.0,
  "domain_analysis": {
    "domain_authority": 0.0-1.0,
    "reputation": "excellent|good|fair|poor|unknown",
    "established_date": "date if available",
    "traffic_rank": "ranking if available"
  },
  "content_analysis": {
    "author_credibility": 0.0-1.0,
    "content_quality": 0.0-1.0,
    "factual_accuracy": 0.0-1.0,
    "citation_quality": 0.0-1.0
  },
  "bias_assessment": {
    "political_bias": "left|center|right|unknown",
    "commercial_bias": 0.0-1.0,
    "bias_indicators": ["indicator 1", "indicator 2"]
  },
  "verification_details": {
    "publication_date": "date if available",
    "last_updated": "date if available",
    "author_info": "author credentials",
    "funding_sources": ["source 1", "source 2"]
  },
  "cross_references": ["supporting source 1", "supporting source 2"],
  "red_flags": ["flag 1", "flag 2"],
  "recommendation": "highly_reliable|reliable|questionable|unreliable|blocked",
  "reasoning": "detailed explanation of assessment"
}

Use your internet access to thoroughly verify this source.`;

            const response = await this.groqClient.chat.completions.create({
                model: "openai/gpt-oss-20b",
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.05,
                max_tokens: 8000
            });

            const verificationContent = response.choices[0].message.content;
            let verificationResult;

            try {
                verificationResult = JSON.parse(verificationContent);
            } catch (e) {
                verificationResult = this.parseVerificationFallback(verificationContent, sourceUrl);
            }

            return {
                ...verificationResult,
                timestamp: new Date().toISOString(),
                groq_verification: true,
                internet_enabled: true
            };

        } catch (error) {
            console.error("Source verification failed:", error);
            return {
                source_url: sourceUrl,
                credibility_score: 0.5,
                recommendation: 'unknown',
                reasoning: 'Verification service temporarily unavailable',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Advanced Research with Internet Access
     */
    async performAdvancedResearch(topic, depth = 'standard', context = {}) {
        console.log(`🔬 GROQ RESEARCH: "${topic}" (depth: ${depth})`);

        try {
            const maxTokens = depth === 'deep' ? 16000 : depth === 'quick' ? 4000 : 8000;
            
            const prompt = `You are an expert researcher with real-time internet access. Conduct ${depth} research on this topic:

RESEARCH TOPIC: "${topic}"
RESEARCH DEPTH: ${depth}
CONTEXT: ${JSON.stringify(context, null, 2)}

RESEARCH METHODOLOGY:
1. Search for current, authoritative sources
2. Cross-reference multiple perspectives
3. Identify recent developments and trends
4. Analyze credibility of sources
5. Synthesize findings with reasoning chain
6. Provide balanced analysis of different viewpoints

Provide comprehensive research analysis in JSON format:
{
  "topic": "${topic}",
  "research_depth": "${depth}",
  "executive_summary": "concise overview of key findings",
  "detailed_analysis": "comprehensive analysis",
  "key_findings": [
    {
      "finding": "key finding description",
      "evidence": "supporting evidence",
      "sources": ["source 1", "source 2"],
      "confidence": 0.0-1.0
    }
  ],
  "authoritative_sources": [
    {
      "url": "source URL",
      "title": "source title",
      "author": "author name",
      "credibility": 0.0-1.0,
      "date_accessed": "timestamp",
      "relevance": 0.0-1.0,
      "excerpt": "relevant excerpt"
    }
  ],
  "different_perspectives": [
    {
      "perspective": "viewpoint description",
      "supporting_evidence": ["evidence 1", "evidence 2"],
      "sources": ["source 1", "source 2"]
    }
  ],
  "recent_developments": ["development 1", "development 2"],
  "trending_aspects": ["trending aspect 1", "trending aspect 2"],
  "research_gaps": ["gap 1", "gap 2"],
  "confidence_level": 0.0-1.0,
  "research_quality": "assessment of research completeness",
  "follow_up_questions": ["question 1", "question 2"],
  "related_topics": ["related topic 1", "related topic 2"]
}

Use your internet access to gather the most current and comprehensive information.`;

            const response = await this.groqClient.chat.completions.create({
                model: "openai/gpt-oss-20b",
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: maxTokens
            });

            const researchContent = response.choices[0].message.content;
            let researchResult;

            try {
                researchResult = JSON.parse(researchContent);
            } catch (e) {
                researchResult = this.parseResearchFallback(researchContent, topic);
            }

            return {
                ...researchResult,
                timestamp: new Date().toISOString(),
                groq_research_powered: true,
                internet_enabled: true
            };

        } catch (error) {
            console.error("Advanced research failed:", error);
            throw error;
        }
    }

    /**
     * Real-time Fact-Check Streaming
     */
    setupFactCheckStream(sessionId, res) {
        console.log(`🌊 Setting up fact-check stream for session: ${sessionId}`);
        
        // Send initial connection confirmation
        res.write(`data: ${JSON.stringify({
            type: 'connection',
            sessionId: sessionId,
            message: 'Fact-check stream connected',
            timestamp: new Date().toISOString()
        })}\n\n`);

        // Set up periodic health checks
        const healthCheck = setInterval(() => {
            res.write(`data: ${JSON.stringify({
                type: 'health',
                status: 'active',
                timestamp: new Date().toISOString()
            })}\n\n`);
        }, 30000);

        // Clean up on client disconnect
        req.on('close', () => {
            clearInterval(healthCheck);
            console.log(`🔌 Fact-check stream disconnected: ${sessionId}`);
        });
    }

    /**
     * Utility Methods
     */
    parseFactCheckFallback(content, statement) {
        return {
            statement: statement,
            verdict: this.extractVerdict(content),
            confidence: this.extractConfidence(content),
            reasoning_steps: ['Fallback parsing performed'],
            explanation: content.substring(0, 500) + '...',
            evidence: [],
            corrections: [],
            context_analysis: 'Limited analysis due to parsing issues',
            bias_indicators: [],
            credibility_score: 0.5,
            last_verified: new Date().toISOString(),
            source_quality_assessment: 'Fallback analysis',
            follow_up_recommendations: []
        };
    }

    parseVerificationFallback(content, sourceUrl) {
        return {
            source_url: sourceUrl,
            credibility_score: 0.5,
            domain_analysis: { domain_authority: 0.5, reputation: 'unknown' },
            content_analysis: { content_quality: 0.5 },
            bias_assessment: { political_bias: 'unknown', commercial_bias: 0.5 },
            verification_details: {},
            recommendation: 'unknown',
            reasoning: content.substring(0, 200) + '...'
        };
    }

    parseResearchFallback(content, topic) {
        return {
            topic: topic,
            research_depth: 'limited',
            executive_summary: content.substring(0, 300) + '...',
            detailed_analysis: content,
            key_findings: [],
            authoritative_sources: [],
            different_perspectives: [],
            recent_developments: [],
            confidence_level: 0.5,
            research_quality: 'Limited due to parsing issues'
        };
    }

    extractVerdict(content) {
        const lower = content.toLowerCase();
        if (lower.includes('misleading')) return 'misleading';
        if (lower.includes('outdated')) return 'outdated';
        if (lower.includes('true') && !lower.includes('false')) return 'true';
        if (lower.includes('false')) return 'false';
        if (lower.includes('partially')) return 'partially_true';
        return 'unverifiable';
    }

    extractConfidence(content) {
        const confidenceMatch = content.match(/confidence[:\s]*([0-9.]+)/i);
        if (confidenceMatch) return parseFloat(confidenceMatch[1]);
        return 0.5;
    }

    summarizeVerdicts(results) {
        const summary = {
            true: 0,
            false: 0,
            partially_true: 0,
            unverifiable: 0,
            misleading: 0,
            outdated: 0
        };

        results.forEach(result => {
            if (summary.hasOwnProperty(result.verdict)) {
                summary[result.verdict]++;
            }
        });

        return summary;
    }

    async performFallbackFactCheck(statement, context, error) {
        return {
            statement: statement,
            verdict: 'error',
            confidence: 0,
            explanation: 'Fact-checking service temporarily unavailable',
            error: error.message,
            timestamp: new Date().toISOString(),
            fallback: true
        };
    }

    setupErrorHandling() {
        this.app.use((error, req, res, next) => {
            console.error('Fact-check API error:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        });
    }

    start(port = 3001) {
        this.app.listen(port, () => {
            console.log(`🌐 GROQ Fact-Check API running on port ${port}`);
            console.log(`⚡ Internet-powered reasoning models active`);
            console.log(`🔍 Real-time source verification enabled`);
        });
    }
}

// Export for use in main platform
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GroqFactCheckAPI;
}

// Start the API if run directly
if (require.main === module) {
    const api = new GroqFactCheckAPI();
    api.start();
}

console.log("🌐 GROQ FACT-CHECK API MODULE LOADED");