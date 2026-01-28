import dotenv from 'dotenv';

dotenv.config();

export default {
    langsmith: {
        apiKey: process.env.LANGSMITH_API_KEY || '',
        endpoint: process.env.LANGSMITH_ENDPOINT || 'https://api.smith.langchain.com',
        projectName: process.env.LANGSMITH_PROJECT || 'og-mcp',
        tracingEnabled: process.env.LANGSMITH_TRACING_ENABLED === 'true'
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.OPENAI_MODEL || 'gpt-4.1',
    },
 
    agents: {
        metaTagAnalyzer: {
            model: process.env.META_ANALYZER_MODEL || 'gpt-4.1',
        }
    }
        
}