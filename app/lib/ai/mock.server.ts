import type { AiProvider, AiInput, AiResult } from "./provider";
import type { AiCapability } from "../schema";
export class MockAiProvider implements AiProvider {
  readonly id = "mock";
  readonly simulated = true;
  async run(capability: AiCapability, input: AiInput): Promise<AiResult> {
    const base = {
      simulated: true,
      notice:
        "SIMULATED RESULT: no translation or image processing occurred; no AI credits or API quota were used.",
    };
    if (capability.startsWith("image_"))
      return { ...base, imageId: input.imageId, imageUrl: input.imageUrl };
    if (capability === "attribute_translation")
      return {
        ...base,
        attributes:
          input.attributes?.map((a) => ({
            name: `[MOCK] ${a.name}`,
            value: a.value,
          })) || [],
      };
    return {
      ...base,
      text: `[MOCK — review manually] ${input.text || ""}`.slice(
        0,
        capability === "title_translation"
          ? 255
          : capability === "seo_description"
            ? 320
            : 100000,
      ),
    };
  }
}
