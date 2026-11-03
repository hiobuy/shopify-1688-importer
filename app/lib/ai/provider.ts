import type { AiCapability } from "../schema";
export type AiTaskStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
export interface AiInput {
  text?: string;
  attributes?: { name: string; value: string }[];
  imageId?: string;
  imageUrl?: string;
  targetLanguage?: string;
}
export interface AiResult {
  simulated: boolean;
  notice: string;
  text?: string;
  attributes?: { name: string; value: string }[];
  imageId?: string;
  imageUrl?: string;
  assetId?: string;
  remoteUrl?: string;
  creditsUsed?: number;
  characterCount?: number;
}
export interface AiProvider {
  readonly id: string;
  readonly simulated: boolean;
  run(capability: AiCapability, input: AiInput): Promise<AiResult>;
}
