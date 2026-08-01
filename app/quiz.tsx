import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, CheckCircle2, Mic, RotateCcw, XCircle } from 'lucide-react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { WT } from '@/constants/wiretrace';
import { AppLanguage, isSpanish, loadAppLanguage } from '@/utils/app-language';
import { getSchematic, listStandards, SchematicAnalysis } from '@/utils/schematic-storage';
import { generateQuizQuestions, QuizQuestion, QuizResult, scoreQuizResults } from '@/utils/quiz';
import { parseQuizAnswer } from '@/utils/openrouter';
import { loadTTSSettings, speakTextWithSettings, stopSpeech, TTSSettings } from '@/utils/tts';
import PulsingLogo from '@/components/PulsingLogo';

// Quiz mode: pick a verified standard, get asked spoken questions built from
// its own ground-truth data, answer by holding a mic button, and get graded
// against the standard's real values — a training tool for new hires, not a
// generic trivia feature.

function AnimatedPressable({
  onPress,
  onLongPress,
  onPressOut: onPressOutProp,
  style,
  children,
  scaleValue = 0.97,
  disabled,
}: {
  onPress?: () => void;
  onLongPress?: () => void;
  onPressOut?: () => void;
  style?: object | object[];
  children: React.ReactNode;
  scaleValue?: number;
  disabled?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const animIn = () =>
    Animated.spring(scale, { toValue: scaleValue, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  const animOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  return (
    <Animated.View style={[{ transform: [{ scale }] }]}>
      <Pressable
        disabled={disabled}
        onPressIn={animIn}
        onPressOut={(e) => {
          animOut();
          onPressOutProp?.();
        }}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={200}
        style={style}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

export default function QuizScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ schematicId?: string }>();
  const [language, setLanguage] = useState<AppLanguage>('english');
  const es = isSpanish(language);

  const [standards, setStandards] = useState<SchematicAnalysis[]>([]);
  const [schematic, setSchematic] = useState<SchematicAnalysis | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<QuizResult[]>([]);
  const [showSummary, setShowSummary] = useState(false);

  const [listening, setListening] = useState(false);
  const [grading, setGrading] = useState(false);
  const [lastResult, setLastResult] = useState<QuizResult | null>(null);
  const [ttsSettings, setTtsSettings] = useState<TTSSettings | null>(null);

  const listeningActiveRef = useRef(false);
  const transcriptRef = useRef('');

  useFocusEffect(
    useCallback(() => {
      loadAppLanguage().then(setLanguage).catch(console.error);
      loadTTSSettings().then(setTtsSettings).catch(console.error);
      if (!params.schematicId) {
        listStandards().then(setStandards).catch(console.error);
      }
    }, [params.schematicId])
  );

  useEffect(() => {
    if (!params.schematicId) return;
    getSchematic(params.schematicId).then((s) => {
      if (!s) return;
      setSchematic(s);
      const qs = generateQuizQuestions(s, 8);
      setQuestions(qs);
    });
  }, [params.schematicId]);

  useEffect(() => {
    return () => {
      stopSpeech().catch(() => {});
    };
  }, []);

  const currentQuestion = questions[currentIndex] ?? null;

  useEffect(() => {
    if (currentQuestion && ttsSettings) {
      speakTextWithSettings(ttsSettings, currentQuestion.prompt).catch(() => {});
    }
  }, [currentQuestion?.id]);

  const startListening = async () => {
    if (listening || grading || !currentQuestion) return;
    console.log('[Quiz] Starting answer recording');
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) return;
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) return;
      listeningActiveRef.current = true;
      transcriptRef.current = '';
      setListening(true);
      ExpoSpeechRecognitionModule.start({
        lang: es ? 'es-US' : 'en-US',
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
      });
    } catch (e) {
      console.error('[Quiz] Failed to start recording', e);
    }
  };

  const stopListening = () => {
    if (!listeningActiveRef.current) return;
    listeningActiveRef.current = false;
    setListening(false);
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (e) {
      console.error('[Quiz] Failed to stop recording', e);
    }
  };

  const processAnswer = async () => {
    const transcript = transcriptRef.current.trim();
    const question = questions[currentIndex];
    if (!transcript || !question) return;
    setGrading(true);
    try {
      const graded = await parseQuizAnswer(question.prompt, question.correctAnswer, transcript);
      const result: QuizResult = {
        question,
        transcript,
        correct: graded.correct,
        feedback: graded.feedback,
      };
      setResults((prev) => [...prev, result]);
      setLastResult(result);
      if (ttsSettings) {
        const speech = graded.correct
          ? es
            ? 'Correcto.'
            : 'Correct.'
          : `${es ? 'Incorrecto.' : 'Not quite.'} ${es ? 'La respuesta correcta es' : 'The correct answer is'} ${question.correctAnswer}.`;
        speakTextWithSettings(ttsSettings, speech).catch(() => {});
      }
    } catch (e) {
      console.error('[Quiz] Failed to grade answer', e);
    } finally {
      setGrading(false);
    }
  };

  const nextQuestion = () => {
    setLastResult(null);
    stopSpeech().catch(() => {});
    if (currentIndex + 1 >= questions.length) {
      setShowSummary(true);
    } else {
      setCurrentIndex((i) => i + 1);
    }
  };

  const restartQuiz = () => {
    if (!schematic) return;
    setResults([]);
    setLastResult(null);
    setShowSummary(false);
    setCurrentIndex(0);
    setQuestions(generateQuizQuestions(schematic, 8));
  };

  useSpeechRecognitionEvent('result', (event: any) => {
    if (!listeningActiveRef.current) return;
    const rawResults = Array.isArray(event?.results) ? event.results : [];
    for (let i = rawResults.length - 1; i >= 0; i -= 1) {
      const text = rawResults[i]?.transcript;
      if (typeof text === 'string' && text.trim()) {
        transcriptRef.current = text.trim();
        break;
      }
    }
  });

  useSpeechRecognitionEvent('end', () => {
    if (listening) {
      setListening(false);
      processAnswer();
    }
  });

  const header = (title: string) => (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <AnimatedPressable onPress={() => router.back()} style={styles.backBtn} scaleValue={0.9}>
        <ArrowLeft size={22} color={WT.blue} />
      </AnimatedPressable>
      <View style={styles.headerCenter}>
        <PulsingLogo size={20} />
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      <View style={{ width: 44 }} />
    </View>
  );

  // Picker: no schematicId given — choose a standard to quiz against.
  if (!params.schematicId) {
    return (
      <View style={styles.root}>
        {header(es ? 'Modo de Cuestionario' : 'Quiz Mode')}
        <Text style={styles.subtitle}>
          {es
            ? 'Elige un estándar verificado para poner a prueba a tu equipo'
            : 'Pick a verified standard to test your crew on'}
        </Text>
        <ScrollView contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 32 }]}>
          {standards.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>{es ? 'Aún no hay estándares' : 'No standards yet'}</Text>
              <Text style={styles.emptySubtitle}>
                {es
                  ? 'Guarda un esquema corregido como estándar para poder usarlo en un cuestionario.'
                  : 'Save a corrected schematic as a standard before you can quiz on it.'}
              </Text>
            </View>
          )}
          {standards.map((s) => (
            <AnimatedPressable
              key={s.id}
              style={styles.card}
              onPress={() => router.setParams({ schematicId: s.id })}
            >
              <Text style={styles.cardName} numberOfLines={1}>
                {s.standardName || s.name}
              </Text>
              <Text style={styles.metaText}>
                {s.wireCount} {es ? 'cables' : 'wires'} · {s.componentCount} {es ? 'partes' : 'parts'}
              </Text>
            </AnimatedPressable>
          ))}
        </ScrollView>
      </View>
    );
  }

  if (!schematic || questions.length === 0) {
    return (
      <View style={styles.root}>
        {header(es ? 'Modo de Cuestionario' : 'Quiz Mode')}
        <View style={styles.emptyState}>
          <Text style={styles.emptySubtitle}>
            {es ? 'Cargando cuestionario...' : 'Loading quiz...'}
          </Text>
        </View>
      </View>
    );
  }

  if (showSummary) {
    const score = scoreQuizResults(results);
    const missed = results.filter((r) => !r.correct);
    return (
      <View style={styles.root}>
        {header(es ? 'Resultados' : 'Results')}
        <ScrollView contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 32 }]}>
          <View style={styles.scoreCard}>
            <Text style={styles.scorePercent}>{score.percent}%</Text>
            <Text style={styles.scoreFraction}>
              {score.correct} / {score.total} {es ? 'correctas' : 'correct'}
            </Text>
          </View>
          {missed.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>{es ? 'Repasar' : 'Review'}</Text>
              {missed.map((r) => (
                <View key={r.question.id} style={styles.reviewCard}>
                  <Text style={styles.reviewQuestion}>{r.question.prompt}</Text>
                  <Text style={styles.reviewYouSaid}>
                    {es ? 'Dijiste' : 'You said'}: "{r.transcript}"
                  </Text>
                  <Text style={styles.reviewCorrect}>
                    {es ? 'Correcto' : 'Correct'}: {r.question.correctAnswer}
                  </Text>
                </View>
              ))}
            </>
          )}
          <AnimatedPressable onPress={restartQuiz} style={styles.retryBtn}>
            <RotateCcw size={16} color={WT.bg} />
            <Text style={styles.retryBtnText}>{es ? 'Reintentar' : 'Retry Quiz'}</Text>
          </AnimatedPressable>
          <AnimatedPressable onPress={() => router.back()} style={styles.doneBtn}>
            <Text style={styles.doneBtnText}>{es ? 'Listo' : 'Done'}</Text>
          </AnimatedPressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {header(schematic.standardName || schematic.name)}
      <View style={styles.progressRow}>
        <Text style={styles.progressText}>
          {es ? 'Pregunta' : 'Question'} {currentIndex + 1} / {questions.length}
        </Text>
      </View>

      <View style={styles.questionArea}>
        <Text style={styles.questionText}>{currentQuestion?.prompt}</Text>

        {lastResult && (
          <View
            style={[
              styles.feedbackCard,
              lastResult.correct ? styles.feedbackCardCorrect : styles.feedbackCardWrong,
            ]}
          >
            {lastResult.correct ? (
              <CheckCircle2 size={20} color={WT.green} />
            ) : (
              <XCircle size={20} color={WT.red} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.feedbackYouSaid}>"{lastResult.transcript}"</Text>
              {!lastResult.correct && (
                <Text style={styles.feedbackCorrectAnswer}>
                  {es ? 'Correcto' : 'Correct'}: {lastResult.question.correctAnswer}
                </Text>
              )}
              {!!lastResult.feedback && <Text style={styles.feedbackText}>{lastResult.feedback}</Text>}
            </View>
          </View>
        )}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        {lastResult ? (
          <AnimatedPressable onPress={nextQuestion} style={styles.nextBtn}>
            <Text style={styles.nextBtnText}>
              {currentIndex + 1 >= questions.length ? (es ? 'Ver Resultados' : 'See Results') : es ? 'Siguiente' : 'Next Question'}
            </Text>
          </AnimatedPressable>
        ) : (
          <AnimatedPressable
            onLongPress={startListening}
            onPressOut={stopListening}
            disabled={grading}
            style={[styles.micBtn, listening && styles.micBtnActive]}
          >
            <Mic size={20} color={listening ? WT.green : WT.blue} />
            <Text style={styles.micBtnText}>
              {grading
                ? es
                  ? 'Calificando...'
                  : 'Grading...'
                : listening
                ? es
                  ? 'Escuchando...'
                  : 'Listening...'
                : es
                ? 'Mantén presionado para responder'
                : 'Hold to answer'}
            </Text>
          </AnimatedPressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: WT.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: WT.border,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: WT.textPrimary },
  subtitle: {
    fontSize: 12,
    color: WT.textSecondary,
    textAlign: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  listContent: { paddingHorizontal: 20, gap: 10 },
  card: {
    backgroundColor: WT.bgCard,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: WT.border,
    gap: 4,
  },
  cardName: { fontSize: 15, fontWeight: '600', color: WT.textPrimary },
  metaText: { fontSize: 12, color: WT.textSecondary },
  emptyState: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 30, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: WT.textPrimary },
  emptySubtitle: { fontSize: 14, color: WT.textSecondary, textAlign: 'center', lineHeight: 20 },
  progressRow: { paddingHorizontal: 20, paddingTop: 14 },
  progressText: { fontSize: 12, color: WT.textTertiary, fontWeight: '600' },
  questionArea: { flex: 1, paddingHorizontal: 24, paddingTop: 24, gap: 20 },
  questionText: { fontSize: 22, fontWeight: '700', color: WT.textPrimary, lineHeight: 30 },
  feedbackCard: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  feedbackCardCorrect: { backgroundColor: WT.greenMuted, borderColor: WT.green },
  feedbackCardWrong: { backgroundColor: WT.redMuted, borderColor: WT.red },
  feedbackYouSaid: { fontSize: 14, color: WT.textPrimary, fontStyle: 'italic' },
  feedbackCorrectAnswer: { fontSize: 13, color: WT.textPrimary, fontWeight: '600', marginTop: 4 },
  feedbackText: { fontSize: 12, color: WT.textSecondary, marginTop: 4 },
  footer: { paddingHorizontal: 20, paddingTop: 8 },
  micBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: WT.bgCard,
    borderWidth: 1,
    borderColor: WT.blueDim,
    borderRadius: 16,
    paddingVertical: 18,
  },
  micBtnActive: { borderColor: WT.green, backgroundColor: WT.greenMuted },
  micBtnText: { fontSize: 15, fontWeight: '600', color: WT.textPrimary },
  nextBtn: {
    backgroundColor: WT.blue,
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  nextBtnText: { fontSize: 15, fontWeight: '700', color: WT.bg },
  scoreCard: { alignItems: 'center', paddingVertical: 24, gap: 4 },
  scorePercent: { fontSize: 48, fontWeight: '800', color: WT.blue },
  scoreFraction: { fontSize: 14, color: WT.textSecondary },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: WT.textTertiary, marginTop: 8, marginBottom: -2 },
  reviewCard: {
    backgroundColor: WT.bgCard,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: WT.border,
    gap: 4,
  },
  reviewQuestion: { fontSize: 14, fontWeight: '600', color: WT.textPrimary },
  reviewYouSaid: { fontSize: 12, color: WT.textSecondary, fontStyle: 'italic' },
  reviewCorrect: { fontSize: 12, color: WT.green, fontWeight: '600' },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: WT.blue,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 12,
  },
  retryBtnText: { fontSize: 14, fontWeight: '700', color: WT.bg },
  doneBtn: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  doneBtnText: { fontSize: 14, fontWeight: '600', color: WT.textSecondary },
});
