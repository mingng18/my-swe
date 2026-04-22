/**
 * Multimodal content utilities for handling text and image blocks.
 */

import { createLogger } from "./logger";
import * as dns from "node:dns";
import { promisify } from "node:util";

const lookupAsync = promisify(dns.lookup);

const logger = createLogger("multimodal");

export interface ContentBlock {
  type: "text" | "image";
  text?: string;
  image_url?: { url: string };
}

export interface MessagePayload {
  text?: string;
  image_urls?: string[];
}

/**
 * Fetch an image from a URL and convert it to a content block.
 * Handles both base64 data URLs and external image URLs.
 */
export async function fetchImageBlock(
  imageUrl: string,
): Promise<ContentBlock | null> {
  try {
    // If it's already a base64 data URL, use it directly
    if (imageUrl.startsWith("data:image/")) {
      return {
        type: "image",
        image_url: { url: imageUrl },
      };
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(imageUrl);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        logger.warn({ imageUrl }, "Invalid protocol");
        return null;
      }

      const { address } = await lookupAsync(parsedUrl.hostname);
      // Normalize IPv4-mapped IPv6 addresses for accurate checking
      let normalizedAddress = address.toLowerCase();
      normalizedAddress = normalizedAddress.replace(/^(?:0+:)+ffff:/, "");
      if (normalizedAddress.startsWith("::ffff:")) {
        normalizedAddress = normalizedAddress.substring(7);
      }

      if (
        normalizedAddress.startsWith("127.") ||
        normalizedAddress.startsWith("169.254.") ||
        normalizedAddress.startsWith("10.") ||
        normalizedAddress.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) ||
        normalizedAddress.startsWith("192.168.") ||
        normalizedAddress === "0.0.0.0" ||
        normalizedAddress === "::1" ||
        normalizedAddress === "::" ||
        normalizedAddress.startsWith("fc00:") ||
        normalizedAddress.startsWith("fd") ||
        normalizedAddress.startsWith("fe80:")
      ) {
        logger.warn(
          { imageUrl, address },
          "Local and private addresses are not allowed",
        );
        return null;
      }
    } catch (e) {
      logger.warn(
        { imageUrl, error: e },
        "Invalid URL or DNS resolution failed",
      );
      return null;
    }

    // Fetch external image and convert to base64
    const response = await fetch(imageUrl);
    if (!response.ok) {
      logger.warn(
        { imageUrl, status: response.statusText },
        "Failed to fetch image",
      );
      return null;
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mimeType = response.headers.get("content-type") || "image/png";

    return {
      type: "image",
      image_url: { url: `data:${mimeType};base64,${base64}` },
    };
  } catch (error) {
    logger.warn({ imageUrl, error }, "Error fetching image");
    return null;
  }
}

/**
 * Build content blocks from a message payload containing text and/or image URLs.
 */
export async function buildBlocksFromPayload(
  payload: MessagePayload,
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];

  // Add text block if present
  if (payload.text) {
    blocks.push({ type: "text", text: payload.text });
  }

  // Add image blocks if present
  if (payload.image_urls && payload.image_urls.length > 0) {
    const chunkSize = 5;
    for (let i = 0; i < payload.image_urls.length; i += chunkSize) {
      const chunk = payload.image_urls.slice(i, i + chunkSize);
      const chunkBlocks = await Promise.all(
        chunk.map((imageUrl) => fetchImageBlock(imageUrl)),
      );
      // ⚡ Bolt: Replacing for...of loops that individually push elements with spread push
      // yields measurable CPU performance gains due to internal V8 optimizations.
      blocks.push(...(chunkBlocks.filter(Boolean) as ContentBlock[]));
    }
  }

  return blocks;
}
