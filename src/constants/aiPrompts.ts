export const AI_PROMPTS = {
    ANALYSIS: `
      You are an expert AI Image Generation Prompt Engineer.
      Analyze the following prompt used for an image generation:
      
      "{{prompt}}"
      
      Provide 3 specific improvements or variations to enhance the visual quality or change the style slightly.
      
      At the end, provide exactly ONE "Applied Example" that combines these improvements into a single, high-quality prompt.
      
      Format the output using Markdown. Use "### Analysis" for the list and "### Applied Example" for the example.
      Keep it professional and concise.
    `,

    VARIATIONS: `Take the following image generation prompt and create 3 distinct variations of it.
            
            Original Prompt: "{{prompt}}"
            
            Variation 1: Artistic/Stylized (Change the art medium or style significantly).
            Variation 2: Cinematic/Realistic (Focus on lighting, photography, and realism).
            Variation 3: Creative Twist (Keep the subject but change the setting or mood).
            
            Return ONLY a JSON array of strings. Do not include markdown formatting.`,

    TITLE: `Generate a short, 3-5 word artistic title for an image generated with this prompt: "{{prompt}}". Return ONLY the title, no quotes.`,

    FILTERS: `Translate this user search query into a JSON filter object for an image library: "{{query}}".
            
            Available tools (enums): ComfyUI, Automatic1111, Midjourney, InvokeAI.
            Available models (strings): SDXL 1.0, Stable Diffusion 1.5, Flux.1, Pony Diffusion V6.
            Current local date: {{today}}.
            Date ranges: 'today', 'week', 'month', 'custom', 'all'. For 'custom', return dateFrom and/or dateTo as YYYY-MM-DD.
            
            CRITICAL INSTRUCTIONS:
            1. 'searchQuery': Extract ONLY the key subject matter keywords. Remove conversational phrases like "show me", "find", "images of", "pictures from", "look for". 
               Example: "Show me cyberpunk cities" -> searchQuery: "cyberpunk cities".
               Example: "Find images from yesterday" -> searchQuery: "".
            2. 'dateRange': If the user mentions "today", set dateRange to 'today'. "Last 7 days" -> 'week'. "Last 30 days" -> 'month'. For concrete calendar dates like "yesterday", "April 2026", or "2026-04-15", set dateRange to 'custom' and return absolute dateFrom/dateTo.
            3. 'favoritesOnly': Set to true if "favorites", "liked", or "best" is mentioned.
            4. 'tools'/'models': Match loosely.
            `
} as const;
export type AIPromptKey = keyof typeof AI_PROMPTS;
