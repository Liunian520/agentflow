import { prisma } from '../db';

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function searchKnowledge(queryEmbedding: number[], topK: number) {
  const docs = await prisma.knowledgeDoc.findMany();
  const scored = docs
    .filter(d => d.embedding)
    .map(d => {
      const embedding = JSON.parse(d.embedding!);
      return {
        id: d.id,
        title: d.title,
        content: d.content,
        score: cosineSimilarity(queryEmbedding, embedding),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return scored;
}
