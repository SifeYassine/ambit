

import {
    GoogleGenAI,
    GenerateContentResponse,
    ThinkingLevel,
    Type,
    type ThinkingConfig
} from "@google/genai";
import { FilterState, type AiThinkingMode } from "../types";
import { AI_PROMPTS, AIPromptKey } from "../constants/aiPrompts";
import {
    GeminiFilterResponseSchema,
    PromptVariationsSchema,
    safeParse
} from "../utils/validation";

import {
    DEFAULT_AI_MODEL,
    DEFAULT_AI_THINKING_MODE,
    normalizeAiThinkingMode
} from "../constants/aiModels";
import { formatDateInputValue } from "../utils/dateFilters";

const getAIClient = (apiKey: string) => {
    const key = apiKey || process.env.API_KEY;
    if (!key) throw new Error("API Key is missing. Please add it in Settings > Intelligence.");
    return new GoogleGenAI({ apiKey: key });
};

export const getGeminiThinkingConfig = (
    modelId: string,
    thinkingMode: AiThinkingMode = DEFAULT_AI_THINKING_MODE
): ThinkingConfig | undefined => {
    const normalizedMode = normalizeAiThinkingMode(modelId, thinkingMode);
    if (normalizedMode === 'default') return undefined;

    if (modelId.startsWith('gemini-3')) {
        const thinkingLevels: Partial<Record<AiThinkingMode, ThinkingLevel>> = {
            minimal: ThinkingLevel.MINIMAL,
            low: ThinkingLevel.LOW,
            medium: ThinkingLevel.MEDIUM,
            high: ThinkingLevel.HIGH,
        };
        return { thinkingLevel: thinkingLevels[normalizedMode]! };
    }

    return { thinkingBudget: normalizedMode === 'off' ? 0 : -1 };
};

/**
 * Verifies the validity of an API key by attempting a minimal operation.
 */
export const verifyApiKey = async (apiKey: string, modelId: string = DEFAULT_AI_MODEL): Promise<{ valid: boolean; error?: string }> => {
    try {
        if (!apiKey) return { valid: false, error: "API Key is required" };
        const ai = new GoogleGenAI({ apiKey });

        // Minimal operation: generate content with 1 token output
        // We use a very simple prompt to minimize cost/tokens
        const result = await ai.models.generateContent({
            model: modelId,
            contents: 'ping',
            config: {
                maxOutputTokens: 1
            }
        });

        if (result) {
            return { valid: true };
        }
        return { valid: false, error: "Invalid response from Gemini API" };
    } catch (error: unknown) {
        // Log error but be selective about what we expose to UI
        console.error("Gemini Verification Error:", error);

        let message = "Verification failed";
        const errorStr = String(error).toLowerCase();

        if (errorStr.includes("api_key_invalid") || errorStr.includes("invalid api key")) {
            message = "Invalid API Key";
        } else if (errorStr.includes("quota") || errorStr.includes("rate limit")) {
            message = "Quota exceeded";
        } else if (errorStr.includes("network") || errorStr.includes("fetch")) {
            message = "Network error";
        } else if (errorStr.includes("permission") || errorStr.includes("not found")) {
            message = "Model not found or access denied";
        } else {
            message = error instanceof Error ? error.message : "Unknown error";
        }

        return { valid: false, error: message };
    }
};

/**
 * Helper to resolve prompt (user override vs default)
 */
const resolvePrompt = (key: AIPromptKey, overrides?: Record<string, string>): string => {
    return overrides?.[key] || AI_PROMPTS[key];
};

/**
 * Analyzes a prompt and suggests improvements using Gemini 2.5 Flash.
 */
export const analyzePromptAndSuggest = async (
    currentPrompt: string,
    apiKey: string,
    modelId: string = DEFAULT_AI_MODEL,
    prompts?: Record<string, string>,
    thinkingMode: AiThinkingMode = DEFAULT_AI_THINKING_MODE
): Promise<string> => {
    try {
        const ai = getAIClient(apiKey);
        const template = resolvePrompt('ANALYSIS', prompts);
        const prompt = template.replace('{{prompt}}', currentPrompt);
        const thinkingConfig = getGeminiThinkingConfig(modelId, thinkingMode);

        const response: GenerateContentResponse = await ai.models.generateContent({
            model: modelId,
            contents: prompt,
            config: thinkingConfig ? { thinkingConfig } : undefined
        });

        return response.text || "No suggestions available.";
    } catch (error) {
        console.error("Gemini API Error:", error);
        throw error;
    }
};

/**
 * Generates 3 distinct variations of a prompt.
 */
export const generatePromptVariations = async (
    currentPrompt: string,
    apiKey: string,
    modelId: string = DEFAULT_AI_MODEL,
    prompts?: Record<string, string>,
    thinkingMode: AiThinkingMode = DEFAULT_AI_THINKING_MODE
): Promise<string[]> => {
    try {
        const ai = getAIClient(apiKey);
        const template = resolvePrompt('VARIATIONS', prompts);
        const prompt = template.replace('{{prompt}}', currentPrompt);
        const thinkingConfig = getGeminiThinkingConfig(modelId, thinkingMode);

        const response = await ai.models.generateContent({
            model: modelId,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                },
                ...(thinkingConfig ? { thinkingConfig } : {})
            }
        });

        if (response.text) {
            const parsed = safeParse(PromptVariationsSchema, JSON.parse(response.text));
            return parsed || [];
        }
        return [];
    } catch (error) {
        console.error("Variation Error:", error);
        throw error;
    }
};

/**
 * Generates a creative title for an image based on its prompt.
 */
export const generateTitleFromPrompt = async (
    promptText: string,
    apiKey: string,
    modelId: string = DEFAULT_AI_MODEL,
    prompts?: Record<string, string>,
    thinkingMode: AiThinkingMode = DEFAULT_AI_THINKING_MODE
): Promise<string> => {
    try {
        const ai = getAIClient(apiKey);
        const template = resolvePrompt('TITLE', prompts);
        const prompt = template.replace('{{prompt}}', promptText);
        const thinkingConfig = getGeminiThinkingConfig(modelId, thinkingMode);

        const response: GenerateContentResponse = await ai.models.generateContent({
            model: modelId,
            contents: prompt,
            config: thinkingConfig ? { thinkingConfig } : undefined
        });
        return response.text?.trim() || "Untitled Creation";
    } catch (error) {
        return "Untitled";
    }
};

/**
 * Converts natural language query into a structured FilterState object.
 */
export const generateFiltersFromQuery = async (
    query: string,
    apiKey: string,
    modelId: string = DEFAULT_AI_MODEL,
    prompts?: Record<string, string>,
    thinkingMode: AiThinkingMode = DEFAULT_AI_THINKING_MODE
): Promise<Partial<FilterState>> => {
    try {
        const ai = getAIClient(apiKey);

        const template = resolvePrompt('FILTERS', prompts);
        const prompt = template
            .replace('{{query}}', query)
            .replace('{{today}}', formatDateInputValue(new Date()));
        const thinkingConfig = getGeminiThinkingConfig(modelId, thinkingMode);

        const response = await ai.models.generateContent({
            model: modelId,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                // Schema remains hardcoded as it defines internal logic
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        searchQuery: { type: Type.STRING },
                        models: { type: Type.ARRAY, items: { type: Type.STRING } },
                        tools: { type: Type.ARRAY, items: { type: Type.STRING } },
                        dateRange: { type: Type.STRING, enum: ['today', 'week', 'month', 'custom', 'all'] },
                        dateFrom: { type: Type.STRING },
                        dateTo: { type: Type.STRING },
                        favoritesOnly: { type: Type.BOOLEAN },
                        minSteps: { type: Type.NUMBER },
                        minCfg: { type: Type.NUMBER }
                    }
                },
                ...(thinkingConfig ? { thinkingConfig } : {})
            }
        });

        if (response.text) {
            const parsed = safeParse(GeminiFilterResponseSchema, JSON.parse(response.text));
            if (parsed) {
                return parsed as Partial<FilterState>;
            }
        }
        return { searchQuery: query };
    } catch (error) {
        console.error("NL Search Error:", error);
        return { searchQuery: query }; // Fallback to raw text search
    }
};

