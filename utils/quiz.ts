import type { SchematicAnalysis } from '@/utils/schematic-storage';

// Generates quiz questions from a saved standard so a supervisor can test a
// trainee's understanding of a verified schematic — no new ground truth is
// invented, every question and answer comes straight from the standard's own
// data.

export type QuizQuestionType = 'wire-destination' | 'wire-source' | 'component-id' | 'connection';

export interface QuizQuestion {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  correctAnswer: string;
  relatedLabel: string;
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function generateQuizQuestions(schematic: SchematicAnalysis, count = 8): QuizQuestion[] {
  const pool: QuizQuestion[] = [];

  for (const wire of schematic.wires) {
    if (wire.toPoint) {
      pool.push({
        id: `${wire.id}-to`,
        type: 'wire-destination',
        prompt: `Where does wire ${wire.label} go?`,
        correctAnswer: wire.toPoint,
        relatedLabel: wire.label,
      });
    }
    if (wire.fromPoint) {
      pool.push({
        id: `${wire.id}-from`,
        type: 'wire-source',
        prompt: `Where does wire ${wire.label} start from?`,
        correctAnswer: wire.fromPoint,
        relatedLabel: wire.label,
      });
    }
  }

  for (const component of schematic.components) {
    if (!component.isUnknown && component.type) {
      pool.push({
        id: `${component.id}-type`,
        type: 'component-id',
        prompt: `What kind of component is ${component.label}?`,
        correctAnswer: component.type,
        relatedLabel: component.label,
      });
    }
  }

  for (const conn of schematic.connections) {
    if (conn.wireLabel && conn.to) {
      pool.push({
        id: `${conn.id}-conn`,
        type: 'connection',
        prompt: `What does wire ${conn.wireLabel} connect to from ${conn.from}?`,
        correctAnswer: conn.to,
        relatedLabel: conn.wireLabel,
      });
    }
  }

  return shuffle(pool).slice(0, count);
}

export interface QuizResult {
  question: QuizQuestion;
  transcript: string;
  correct: boolean;
  feedback: string;
}

export function scoreQuizResults(results: QuizResult[]): { correct: number; total: number; percent: number } {
  const correct = results.filter((r) => r.correct).length;
  const total = results.length;
  return { correct, total, percent: total === 0 ? 0 : Math.round((correct / total) * 100) };
}
