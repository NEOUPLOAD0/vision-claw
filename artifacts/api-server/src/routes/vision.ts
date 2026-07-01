import { Router, type Request, type Response } from "express";
import { GoogleGenAI } from "@google/genai";

const router = Router();

function getAI(): GoogleGenAI {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }
  return new GoogleGenAI({ apiKey });
}

router.post(
  "/vision/analyze",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        imageBase64,
        imageMimeType = "image/jpeg",
        audioBase64,
        audioMimeType = "audio/mp4",
        textPrompt,
      } = req.body as {
        imageBase64: string;
        imageMimeType?: string;
        audioBase64?: string;
        audioMimeType?: string;
        textPrompt?: string;
      };

      if (!imageBase64) {
        res.status(400).json({ error: "imageBase64 is required" });
        return;
      }

      const ai = getAI();

      // Build multimodal parts
      const parts: Array<{
        text?: string;
        inlineData?: { data: string; mimeType: string };
      }> = [];

      // Add system prompt
      parts.push({
        text: "You are Vision Claw, a helpful real-time visual AI assistant. Analyze what you see in the image and hear in the audio, then provide a concise, helpful, conversational response. Keep responses under 3 sentences unless more detail is specifically needed. Be direct and useful.",
      });

      // Add the camera image
      parts.push({
        inlineData: {
          data: imageBase64,
          mimeType: imageMimeType,
        },
      });

      // Add audio if provided
      if (audioBase64) {
        parts.push({
          inlineData: {
            data: audioBase64,
            mimeType: audioMimeType,
          },
        });
      }

      // Add text prompt if provided (fallback when no audio)
      if (textPrompt) {
        parts.push({ text: textPrompt });
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts,
          },
        ],
        config: {
          maxOutputTokens: 8192,
        },
      });

      const text = response.text ?? "No response generated.";
      res.json({ response: text });
    } catch (err) {
      req.log.error({ err }, "Vision analyze error");
      res.status(500).json({ error: "Analysis failed. Please try again." });
    }
  },
);

export default router;
