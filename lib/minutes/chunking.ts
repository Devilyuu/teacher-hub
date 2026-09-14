import type { TranscriptSegment } from "@/lib/transcription/types";

export const MINUTES_CHUNK_MAX_CHARS = 8_000;

export type TranscriptChunk = {
  text: string;
  startMs: number;
  endMs: number;
};

function sentencePieces(text: string): string[] {
  const pieces = text.match(/[^。！？!?；;\n]+[。！？!?；;\n]?/g);
  return pieces?.filter(Boolean) ?? [];
}

function splitOversizedText(text: string, maxChars: number): string[] {
  const output: string[] = [];
  let current = "";
  for (const sentence of sentencePieces(text)) {
    if (sentence.length > maxChars) {
      if (current) {
        output.push(current);
        current = "";
      }
      for (let offset = 0; offset < sentence.length; offset += maxChars) {
        output.push(sentence.slice(offset, offset + maxChars));
      }
      continue;
    }
    if (current && current.length + sentence.length > maxChars) {
      output.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current) output.push(current);
  return output;
}

export function chunkTranscriptSegments(
  segments: TranscriptSegment[],
  maxChars = MINUTES_CHUNK_MAX_CHARS,
): TranscriptChunk[] {
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error("纪要分段上限必须是正整数");
  const ordered = [...segments]
    .filter((segment) => segment.text.trim().length > 0)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const chunks: TranscriptChunk[] = [];
  let current: TranscriptChunk | null = null;

  const flush = () => {
    if (current) chunks.push(current);
    current = null;
  };

  for (const segment of ordered) {
    const text = segment.text.trim();
    if (text.length > maxChars) {
      flush();
      const pieces = splitOversizedText(text, maxChars);
      const duration = Math.max(0, segment.endMs - segment.startMs);
      let consumed = 0;
      for (const piece of pieces) {
        const startMs = segment.startMs + Math.floor(duration * consumed / text.length);
        consumed += piece.length;
        const endMs = segment.startMs + Math.floor(duration * consumed / text.length);
        chunks.push({ text: piece, startMs, endMs });
      }
      continue;
    }

    const combined = current ? `${current.text}\n${text}` : text;
    if (current && combined.length > maxChars) flush();
    if (current) {
      current = { text: `${current.text}\n${text}`, startMs: current.startMs, endMs: segment.endMs };
    } else {
      current = { text, startMs: segment.startMs, endMs: segment.endMs };
    }
  }
  flush();
  return chunks;
}
