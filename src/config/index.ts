import dotenv from 'dotenv';

dotenv.config();

export default {
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