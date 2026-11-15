import { z } from 'zod';
import { QUESTION_CATEGORIES } from '../src/types';
import type { EvaluationQuestion } from '../src/types';
import { config } from './config';
import { HttpError } from './errors';

export interface QuestionRequest {
  className?: string;
  semester?: string;
  course?: string;
  academicYear?: string;
}

export type QuestionSource = 'deepseek' | 'gemini' | 'mock';

const outputSchema = z.object({
  questions: z
    .array(
      z.object({
        category: z.enum(QUESTION_CATEGORIES),
        text: z.string().trim().min(8).max(200),
      })
    )
    .min(4)
    .max(12),
});

function buildPrompt(p: QuestionRequest): string {
  return `Write 8 concise, neutral, college-level teacher evaluation survey questions for SIES College.
Context:
- Course: ${p.course || 'Undergraduate Science & Commerce'}
- Class: ${p.className || 'SY B.Sc. Computer Science'}
- Semester: ${p.semester || 'Semester III'}
- Academic Year: ${p.academicYear || '2026-27'}

Requirements:
- Every question must apply to ANY teacher of ANY subject in the class.
- Group the questions evenly across exactly these 4 categories, spelled exactly like this:
  "Subject Mastery & Preparation", "Clarity & Communication", "Classroom Engagement", "Assessment & Availability".
- Each question is a statement a student rates from 1 (Poor) to 5 (Excellent).
- One clear, respectful sentence under 18 words. Positive wording. No questions about personal traits, appearance, caste, religion or gender.

Return ONLY a JSON object in this shape:
{"questions":[{"category":"Clarity & Communication","text":"Concepts are explained clearly with relevant examples."}]}`;
}

/** Accepts either {"questions":[...]} or a bare array, and checks the shape. */
function parseModelJson(raw: string): Array<{ category: string; text: string }> {
  const json = JSON.parse(raw);
  const candidate = Array.isArray(json) ? { questions: json } : json;
  return outputSchema.parse(candidate).questions;
}

async function askDeepSeek(prompt: string): Promise<string> {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ai.deepseekKey}`,
    },
    body: JSON.stringify({
      model: config.ai.deepseekModel,
      messages: [
        { role: 'system', content: 'You write survey questions. You reply with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 1200,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`DeepSeek returned status ${res.status}.`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

async function askGemini(prompt: string): Promise<string> {
  const { GoogleGenAI, Type } = await import('@google/genai');
  const ai = new GoogleGenAI({
    apiKey: config.ai.geminiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
  const response = await ai.models.generateContent({
    model: config.ai.geminiModel,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING, description: 'One of the four evaluation categories.' },
            text: { type: Type.STRING, description: 'The evaluation question text.' },
          },
          required: ['category', 'text'],
        },
      },
    },
  });
  return (response.text ?? '').trim();
}

export async function generateQuestions(
  params: QuestionRequest
): Promise<{ questions: EvaluationQuestion[]; source: QuestionSource }> {
  const provider = config.ai.provider;

  if (provider === 'mock') {
    return { source: 'mock', questions: toQuestions(fallbackQuestions(params)) };
  }

  const ask = provider === 'deepseek' ? askDeepSeek : askGemini;
  const prompt = buildPrompt(params);

  // The model occasionally returns something unusable, so try twice before giving up.
  let lastError = 'The AI service did not return usable questions.';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await ask(prompt);
      return { source: provider, questions: toQuestions(parseModelJson(raw)) };
    } catch (err) {
      lastError = err instanceof Error ? err.message : lastError;
    }
  }
  throw new HttpError(502, `Unable to generate questions right now. ${lastError}`, 'AI_FAILED');
}

function toQuestions(items: Array<{ category: string; text: string }>): EvaluationQuestion[] {
  const stamp = Date.now();
  return items.map((q, i) => ({
    id: `ai-q-${stamp}-${i}`,
    category: q.category,
    text: q.text,
    order: i + 1,
  }));
}

/** Used when no AI key is configured, so the screen still works in development. */
function fallbackQuestions(p: QuestionRequest): Array<{ category: string; text: string }> {
  const levelLabel = p.className ? `for ${p.className}` : 'for this class';
  const semLabel = p.semester ? `(${p.semester})` : '';
  const subjectContext = p.course?.toLowerCase().includes('it')
    ? 'practical lab and theoretical concepts'
    : 'core syllabus topics and real-world applications';

  return [
    { category: 'Subject Mastery & Preparation', text: `The teacher demonstrates thorough command of ${subjectContext} ${semLabel}.`.trim() },
    { category: 'Subject Mastery & Preparation', text: `Lectures ${levelLabel} are well-structured and aligned with the prescribed syllabus.` },
    { category: 'Clarity & Communication', text: 'Complex concepts are explained clearly using relevant examples and structured steps.' },
    { category: 'Clarity & Communication', text: 'The pace of instruction allows students to follow lectures and take notes effectively.' },
    { category: 'Classroom Engagement', text: 'The teacher encourages student questions, discussion, and active classroom participation.' },
    { category: 'Classroom Engagement', text: 'Learning resources, slides, or reference materials shared are helpful for exam readiness.' },
    { category: 'Assessment & Availability', text: 'Internal assessments, assignments, and tests are graded fairly with timely feedback.' },
    { category: 'Assessment & Availability', text: 'The teacher is approachable outside lecture hours for academic doubt resolution.' },
  ];
}
