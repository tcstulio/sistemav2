
// DATA STRUCTURE FOR LOGGING & IMPROVEMENT
export interface ApiLog {
    id: string;
    timestamp: number;
    type: 'DOLIBARR_API' | 'GEMINI_AI';

    // The "Context" or "Function"
    endpoint_or_task: string;

    // The Input
    input_context: string; // URL for API, Prompt for AI
    request_method?: string; // GET, POST, PUT, DELETE
    request_body?: string; // The JSON payload sent (if any)

    // The Initial Output (what the system produced)
    output_data: string; // JSON String or Text

    // The Correction (Ground Truth provided by human)
    corrected_data?: string; // JSON String or Text

    // LIFECYCLE FOR BUG TRACKING
    resolution_status?: 'OPEN' | 'ANALYZED' | 'RESOLVED';
    ai_fix_suggestion?: string; // JSON string with diagnosis and code

    status: 'success' | 'error';
    duration_ms?: number;
}

export interface OptimizationSuggestion {
    target_function: string;
    current_issue: string;
    suggested_prompt_improvement: string;
    reasoning: string;
}
