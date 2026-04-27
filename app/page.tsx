"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SYMBOLS = ["7", "BAR", "🍒", "🔔", "⭐"] as const;
const REEL_STRIP = ["7", "BAR", "🍒", "🔔", "⭐", "BAR", "7", "⭐", "🍒", "🔔"] as const;
const ROUND_COUNT = 10;
const SYMBOL_MS = 170;
const ITEM_HEIGHT = 72;
const STORAGE_KEY = "slot-bit-oshi-best-v1";

type Judge = "Perfect" | "Good" | "Miss";
type Direction = "Early" | "Late" | "Just";

type RoundResult = {
  target: (typeof SYMBOLS)[number];
  diffMs: number;
  absDiffMs: number;
  judge: Judge;
  direction: Direction;
};

type ScoreSummary = {
  perfect: number;
  good: number;
  miss: number;
  successRate: number;
  averageDiff: number;
};

type BestRecord = ScoreSummary & {
  playedAt: string;
};

function getRandomTarget() {
  return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
}

function summarizeResults(results: RoundResult[]): ScoreSummary {
  const perfect = results.filter((result) => result.judge === "Perfect").length;
  const good = results.filter((result) => result.judge === "Good").length;
  const miss = results.filter((result) => result.judge === "Miss").length;
  const successCount = perfect + good;
  const totalDiff = results.reduce((sum, result) => sum + result.absDiffMs, 0);

  return {
    perfect,
    good,
    miss,
    successRate: results.length === 0 ? 0 : Math.round((successCount / results.length) * 100),
    averageDiff: results.length === 0 ? 0 : Math.round(totalDiff / results.length),
  };
}

function isBetterRecord(next: ScoreSummary, current: BestRecord | null) {
  if (!current) {
    return true;
  }

  if (next.perfect !== current.perfect) {
    return next.perfect > current.perfect;
  }

  if (next.successRate !== current.successRate) {
    return next.successRate > current.successRate;
  }

  return next.averageDiff < current.averageDiff;
}

function judgeStopTiming(target: (typeof SYMBOLS)[number], elapsedMs: number): RoundResult {
  const targetIndexes = REEL_STRIP.reduce<number[]>((indexes, symbol, index) => {
    if (symbol === target) {
      indexes.push(index);
    }

    return indexes;
  }, []);
  const cycleMs = REEL_STRIP.length * SYMBOL_MS;
  const diffs = targetIndexes.map((index) => {
    const targetTime = index * SYMBOL_MS;
    const cycleOffset = Math.round((elapsedMs - targetTime) / cycleMs);
    const nearestTargetTime = targetTime + cycleOffset * cycleMs;

    return elapsedMs - nearestTargetTime;
  });
  const diffMs = diffs.reduce((nearest, diff) =>
    Math.abs(diff) < Math.abs(nearest) ? diff : nearest,
  );
  const absDiffMs = Math.round(Math.abs(diffMs));
  const roundedDiffMs = Math.round(diffMs);

  return {
    target,
    diffMs: roundedDiffMs,
    absDiffMs,
    judge: absDiffMs <= 30 ? "Perfect" : absDiffMs <= 80 ? "Good" : "Miss",
    direction: absDiffMs <= 2 ? "Just" : roundedDiffMs < 0 ? "Early" : "Late",
  };
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function Home() {
  const [target, setTarget] = useState<(typeof SYMBOLS)[number]>("7");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [lastResult, setLastResult] = useState<RoundResult | null>(null);
  const [bestRecord, setBestRecord] = useState<BestRecord | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const roundStartRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const isStoppingRef = useRef(false);

  const score = useMemo(() => summarizeResults(results), [results]);
  const isFinished = results.length >= ROUND_COUNT;
  const currentRound = isSpinning || !lastResult
    ? Math.min(results.length + 1, ROUND_COUNT)
    : results.length;
  const progress = elapsedMs / SYMBOL_MS;
  const baseIndex = Math.floor(progress);
  const fractionalProgress = progress - baseIndex;

  const visibleSymbols = useMemo(
    () =>
      Array.from({ length: 7 }, (_, visibleIndex) => {
        const stripIndex =
          (baseIndex + visibleIndex - 3 + REEL_STRIP.length * 1000) % REEL_STRIP.length;

        return {
          key: `${baseIndex}-${visibleIndex}-${stripIndex}`,
          symbol: REEL_STRIP[stripIndex],
        };
      }),
    [baseIndex],
  );

  const startRound = useCallback((nextResults: RoundResult[] = results) => {
    if (nextResults.length >= ROUND_COUNT) {
      return;
    }

    isStoppingRef.current = false;
    setTarget(getRandomTarget());
    setLastResult(null);
    setElapsedMs(0);
    roundStartRef.current = performance.now();
    setIsSpinning(true);
  }, [results]);

  const resetGame = useCallback(() => {
    const freshResults: RoundResult[] = [];

    setResults(freshResults);
    startRound(freshResults);
  }, [startRound]);

  const clearBestRecord = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setBestRecord(null);
  }, []);

  const stopReel = useCallback(() => {
    if (isStoppingRef.current || !isSpinning || isFinished) {
      return;
    }

    isStoppingRef.current = true;
    const stoppedElapsedMs = performance.now() - roundStartRef.current;
    const result = judgeStopTiming(target, stoppedElapsedMs);
    const nextResults = [...results, result];

    setElapsedMs(stoppedElapsedMs);
    setIsSpinning(false);
    setLastResult(result);
    setResults(nextResults);

    if (nextResults.length === ROUND_COUNT) {
      const nextScore = summarizeResults(nextResults);

      if (isBetterRecord(nextScore, bestRecord)) {
        const nextBestRecord = {
          ...nextScore,
          playedAt: new Date().toISOString(),
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextBestRecord));
        setBestRecord(nextBestRecord);
      }
    }
  }, [bestRecord, isFinished, isSpinning, results, target]);

  useEffect(() => {
    const setupFrame = requestAnimationFrame(() => {
      const savedBestRecord = localStorage.getItem(STORAGE_KEY);

      if (savedBestRecord) {
        try {
          setBestRecord(JSON.parse(savedBestRecord) as BestRecord);
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }

      setIsLoaded(true);
      roundStartRef.current = performance.now();
      setIsSpinning(true);
    });

    return () => cancelAnimationFrame(setupFrame);
  }, []);

  useEffect(() => {
    if (!isSpinning) {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }

      return;
    }

    const tick = () => {
      setElapsedMs(performance.now() - roundStartRef.current);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [isSpinning]);

  return (
    <main
      className="min-h-dvh bg-[#111318] px-3 py-3 text-zinc-50 sm:px-6 sm:py-5 lg:px-8"
      style={{
        paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
        paddingTop: "max(0.75rem, env(safe-area-inset-top))",
      }}
    >
      <div className="mx-auto flex min-h-[calc(100dvh-1.5rem)] w-full max-w-6xl flex-col gap-3 sm:min-h-[calc(100dvh-2.5rem)] sm:gap-5">
        <header className="flex flex-col gap-2 border-b border-zinc-700/80 pb-3 sm:flex-row sm:items-end sm:justify-between sm:gap-3 sm:pb-4">
          <div>
            <p className="text-xs font-bold text-amber-300 sm:text-sm">10 CHALLENGE MODE</p>
            <h1 className="mt-1 text-2xl font-black tracking-normal text-white sm:text-5xl">
              スロット ビタ押し練習
            </h1>
          </div>
          <div className="grid grid-cols-4 gap-1.5 text-sm sm:gap-2">
            <ScoreBadge label="Perfect" value={score.perfect} tone="text-emerald-300" />
            <ScoreBadge label="Good" value={score.good} tone="text-sky-300" />
            <ScoreBadge label="Miss" value={score.miss} tone="text-rose-300" />
            <ScoreBadge label="成功率" value={`${score.successRate}%`} tone="text-amber-300" />
          </div>
        </header>

        <section className="grid flex-1 gap-3 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-zinc-700 bg-[#181b22] p-3 shadow-2xl shadow-black/35 sm:min-h-[560px] sm:gap-5 sm:p-6">
            <div className="flex w-full max-w-md items-center justify-between gap-3">
              <div className="rounded-lg border border-amber-300/50 bg-amber-300 px-3 py-2 text-[#18120a] shadow-lg shadow-amber-950/30 sm:px-4 sm:py-3">
                <p className="text-xs font-black">狙え</p>
                <p className="text-3xl font-black leading-none sm:text-4xl">{target}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-zinc-400 sm:text-sm">ROUND</p>
                <p className="text-2xl font-black sm:text-3xl">
                  {currentRound}
                  <span className="text-base text-zinc-400"> / {ROUND_COUNT}</span>
                </p>
              </div>
            </div>

            <div className="relative h-[288px] w-full max-w-[232px] overflow-hidden rounded-lg border-4 border-zinc-950 bg-zinc-950 shadow-inner shadow-black sm:h-[360px] sm:max-w-[260px]">
              <div className="absolute left-0 right-0 top-1/2 z-20 h-[72px] -translate-y-1/2 border-y-2 border-amber-300 bg-amber-300/10 shadow-[0_0_28px_rgba(252,211,77,0.45)]" />
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-zinc-950 to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 bg-gradient-to-t from-zinc-950 to-transparent" />
              <div
                className="absolute left-4 right-4 top-1/2"
                style={{
                  transform: `translateY(${-(3.5 + fractionalProgress) * ITEM_HEIGHT}px)`,
                }}
              >
                {visibleSymbols.map((item) => (
                  <div
                    className="flex h-[72px] items-center justify-center border-b border-zinc-700 bg-gradient-to-b from-zinc-100 to-zinc-300 text-5xl font-black text-zinc-950 shadow-inner"
                    key={item.key}
                  >
                    {item.symbol}
                  </div>
                ))}
              </div>
            </div>

            <button
              className="h-20 w-full max-w-md select-none rounded-lg border-b-8 border-red-950 bg-red-600 text-3xl font-black text-white shadow-xl shadow-red-950/40 transition active:translate-y-1 active:border-b-4 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-700 disabled:text-zinc-400"
              disabled={!isLoaded || !isSpinning || isFinished}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  stopReel();
                }
              }}
              onPointerDown={stopReel}
              type="button"
            >
              STOP
            </button>

            <div
              aria-live="polite"
              className="min-h-[84px] w-full max-w-md rounded-lg border border-zinc-700 bg-[#101217] p-3 text-center sm:min-h-[100px] sm:p-4"
            >
              {lastResult ? (
                <>
                  <p
                    className={`text-3xl font-black sm:text-4xl ${
                      lastResult.judge === "Perfect"
                        ? "text-emerald-300"
                        : lastResult.judge === "Good"
                          ? "text-sky-300"
                          : "text-rose-300"
                    }`}
                  >
                    {lastResult.judge}
                  </p>
                  <p className="mt-1 text-base text-zinc-200 sm:mt-2 sm:text-lg">
                    {lastResult.direction} / {lastResult.diffMs > 0 ? "+" : ""}
                    {lastResult.diffMs}ms
                  </p>
                </>
              ) : (
                <div className="flex h-full min-h-14 items-center justify-center text-sm text-zinc-400 sm:min-h-16 sm:text-base">
                  中央ラインにターゲットが来た瞬間を狙ってSTOP
                </div>
              )}
            </div>

            <div className="flex w-full max-w-md gap-2 sm:gap-3">
              <button
                className="h-12 flex-1 rounded-lg bg-amber-300 px-3 text-sm font-black text-zinc-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400 sm:px-4 sm:text-base"
                disabled={isSpinning || isFinished || !lastResult}
                onClick={() => startRound()}
                type="button"
              >
                次のチャレンジ
              </button>
              <button
                className="h-12 rounded-lg border border-zinc-600 px-3 text-sm font-bold text-zinc-100 transition hover:bg-zinc-800 sm:px-4 sm:text-base"
                onClick={resetGame}
                type="button"
              >
                リセット
              </button>
            </div>
          </div>

          <aside className="flex flex-col gap-5">
            <Panel title="現在のスコア">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Perfect" value={score.perfect} />
                <Stat label="Good" value={score.good} />
                <Stat label="Miss" value={score.miss} />
                <Stat label="平均ズレ" value={`${score.averageDiff}ms`} />
              </div>
            </Panel>

            <Panel title="最高記録">
              {bestRecord ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="Perfect" value={bestRecord.perfect} />
                    <Stat label="成功率" value={`${bestRecord.successRate}%`} />
                    <Stat label="Good" value={bestRecord.good} />
                    <Stat label="平均ズレ" value={`${bestRecord.averageDiff}ms`} />
                  </div>
                  <p className="text-sm text-zinc-400">記録日時: {formatDateTime(bestRecord.playedAt)}</p>
                  <button
                    className="h-10 w-full rounded-lg border border-zinc-600 text-sm font-bold text-zinc-200 transition hover:bg-zinc-800"
                    onClick={clearBestRecord}
                    type="button"
                  >
                    最高記録をリセット
                  </button>
                </div>
              ) : (
                <p className="text-sm text-zinc-400">10回チャレンジ完了後に保存されます。</p>
              )}
            </Panel>

            <Panel title="履歴">
              <div className="space-y-2">
                {results.length === 0 ? (
                  <p className="text-sm text-zinc-400">まだ記録はありません。</p>
                ) : (
                  results.map((result, index) => (
                    <div
                      className="flex items-center justify-between rounded-lg bg-zinc-900 px-3 py-2 text-sm"
                      key={`${result.target}-${index}-${result.diffMs}`}
                    >
                      <span className="font-bold">
                        {index + 1}. {result.target}
                      </span>
                      <span className="text-zinc-300">
                        {result.judge} / {result.direction} {result.diffMs > 0 ? "+" : ""}
                        {result.diffMs}ms
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Panel>
          </aside>
        </section>

        {isFinished ? (
          <section className="rounded-lg border border-amber-300/60 bg-[#241d10] p-4 shadow-2xl shadow-black/40 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-black text-amber-300">RESULT</p>
                <h2 className="text-3xl font-black text-white">10回チャレンジ終了</h2>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Stat label="Perfect" value={score.perfect} />
                <Stat label="Good" value={score.good} />
                <Stat label="Miss" value={score.miss} />
                <Stat label="成功率" value={`${score.successRate}%`} />
                <Stat label="平均ズレ" value={`${score.averageDiff}ms`} />
              </div>
              <button
                className="h-12 rounded-lg bg-amber-300 px-5 font-black text-zinc-950 transition hover:bg-amber-200"
                onClick={resetGame}
                type="button"
              >
                もう一度
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function ScoreBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-right">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className={`text-xl font-black ${tone}`}>{value}</p>
    </div>
  );
}

function Panel({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="rounded-lg border border-zinc-700 bg-[#181b22] p-4 shadow-xl shadow-black/25">
      <h2 className="mb-3 text-lg font-black text-white">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-white">{value}</p>
    </div>
  );
}
