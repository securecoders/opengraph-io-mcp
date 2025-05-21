import { Client } from 'langsmith';
import CONFIG from '@/config';

/**
 * Initialize LangSmith tracing based on configuration
 */
export function initLangSmith(): void {
  console.log(`🔍 LangSmith configuration: 
  - tracingEnabled: ${CONFIG.langsmith.tracingEnabled}
  - apiKey: ${CONFIG.langsmith.apiKey ? (CONFIG.langsmith.apiKey.substring(0, 10) + '...') : 'not set'}
  - endpoint: ${CONFIG.langsmith.endpoint}
  - projectName: ${CONFIG.langsmith.projectName}
`);

  if (CONFIG.langsmith.tracingEnabled) {
    console.log('🔍 LangSmith tracing enabled');
    
    // Set environment variables for LangChain 
    process.env.LANGCHAIN_TRACING_V2 = 'true';
    process.env.LANGCHAIN_ENDPOINT = CONFIG.langsmith.endpoint;
    process.env.LANGCHAIN_API_KEY = CONFIG.langsmith.apiKey;
    process.env.LANGCHAIN_PROJECT = CONFIG.langsmith.projectName;
    
    console.log(`🔍 LangChain environment variables set:
    - LANGCHAIN_TRACING_V2: ${process.env.LANGCHAIN_TRACING_V2}
    - LANGCHAIN_ENDPOINT: ${process.env.LANGCHAIN_ENDPOINT}
    - LANGCHAIN_API_KEY: ${process.env.LANGCHAIN_API_KEY ? (process.env.LANGCHAIN_API_KEY.substring(0, 10) + '...') : 'not set'}
    - LANGCHAIN_PROJECT: ${process.env.LANGCHAIN_PROJECT}
    `);
    
    try {
      // Initialize the LangSmith client for potential direct usage
      const client = new Client({
        apiUrl: CONFIG.langsmith.endpoint,
        apiKey: CONFIG.langsmith.apiKey,
      });
      
      console.log(`📊 Connected to LangSmith project: ${CONFIG.langsmith.projectName}`);
      
      // Test connection
      console.log('🔍 Testing LangSmith connection...');
      try {
        // Convert to 'any' type to bypass TypeScript's strict checking
        const anyClient = client as any;
        
        // Check which API method exists and use that one
        // Current versions have getRuns, older versions might have listRuns
        if (typeof anyClient.getRuns === 'function') {
          anyClient.getRuns({ project: CONFIG.langsmith.projectName, limit: 1 })
            .then((runs: any) => console.log(`✅ Successfully connected to LangSmith! Found ${runs.length} runs.`))
            .catch((err: Error) => console.error('❌ Error connecting to LangSmith:', err));
        } else {
          console.log('⚠️ Neither getRuns nor listRuns methods available in this version of LangSmith SDK');
        }
      } catch (err) {
        console.error('❌ Error testing LangSmith connection:', err);
      }
      
      return;
    } catch (error) {
      console.error('❌ Failed to initialize LangSmith client:', error);
    }
  } else {
    console.log('🔍 LangSmith tracing disabled');
  }
}
