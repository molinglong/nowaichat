import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { ProviderDefinition } from "../types"

export const googleProvider: ProviderDefinition = {
  id: "google",
  name: "Google Gemini",
  models: [
    // Gemini 2.5 系列
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "google", contextWindow: 1048576, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google", contextWindow: 1048576, supportsVision: true, supportsFiles: true, supportsReasoning: true },
    // Gemini 2.0 系列
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "google", contextWindow: 1048576, supportsVision: true, supportsFiles: false, supportsReasoning: false },
    { id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash Lite", provider: "google", contextWindow: 1048576, supportsVision: true, supportsFiles: false, supportsReasoning: false },
    // Gemini 1.5 系列
    { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", provider: "google", contextWindow: 2097152, supportsVision: true, supportsFiles: true, supportsReasoning: false },
    { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", provider: "google", contextWindow: 1048576, supportsVision: true, supportsFiles: false, supportsReasoning: false },
    { id: "gemini-1.5-flash-8b", name: "Gemini 1.5 Flash 8B", provider: "google", contextWindow: 1048576, supportsVision: true, supportsFiles: false, supportsReasoning: false },
  ],
  createProvider: (apiKey: string) => createGoogleGenerativeAI({ apiKey }),
}
