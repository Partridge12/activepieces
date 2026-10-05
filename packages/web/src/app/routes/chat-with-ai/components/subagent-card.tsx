import { isObject } from '@activepieces/core-utils';
import { SubagentActivity, SubagentStep } from '@activepieces/shared';
import { t } from 'i18next';
import { Check, ChevronRight, Loader2, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

import { TextWithTooltip } from '@/components/custom/text-with-tooltip';
import { Markdown } from '@/components/prompt-kit/markdown';
import { ToolCallMeta } from '@/features/chat/lib/chat-store';
import { AnyToolPart } from '@/features/chat/lib/chat-types';
import { chatUtils } from '@/features/chat/lib/chat-utils';
import { toolIconUtils } from '@/features/chat/lib/tool-icons';
import { cn } from '@/lib/utils';

export function SubagentGroup({
  builders,
  toolCallMeta,
  isStreaming,
}: {
  builders: { toolCallId: string; part: AnyToolPart }[];
  toolCallMeta: Record<string, ToolCallMeta>;
  isStreaming: boolean;
}) {
  const activities = builders.map(({ toolCallId, part }) => ({
    toolCallId,
    activity: resolveActivity({
      live: toolCallMeta[toolCallId]?.subagent,
      part,
      isStreaming,
    }),
  }));
  const runningCount = activities.filter(
    ({ activity }) => activity.status === 'running',
  ).length;

  return (
    <motion.div
      className="my-2 rounded-xl border bg-gray-1 overflow-hidden"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b">
        <span className="text-xs font-medium text-gray-12">
          {t('{count, plural, =1 {Builder} other {# builders}}', {
            count: builders.length,
          })}
        </span>
        <span className="text-xs text-gray-11 tabular-nums">
          {runningCount > 0
            ? builders.length > 1
              ? t('Working in parallel')
              : t('Working')
            : t('Finished')}
        </span>
      </div>
      <div className="divide-y">
        {activities.map(({ toolCallId, activity }) => (
          <SubagentRow key={toolCallId} activity={activity} />
        ))}
      </div>
    </motion.div>
  );
}

function SubagentRow({ activity }: { activity: SubagentActivity }) {
  const [expanded, setExpanded] = useState(false);
  const running = activity.status === 'running';
  const shownSteps =
    running && !expanded ? activity.steps.slice(-LIVE_STEP_COUNT) : activity.steps;
  const hiddenCount = activity.steps.length - shownSteps.length;
  const showSteps = running || expanded;

  return (
    <div className="px-3.5 py-2.5">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
      >
        <StatusDot status={activity.status} />
        <TextWithTooltip tooltipMessage={activity.flowName}>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-12">
            {activity.flowName}
          </p>
        </TextWithTooltip>
        <span className="shrink-0 text-xs text-gray-11 tabular-nums">
          {running ? (
            <Elapsed startedAt={activity.startedAt} />
          ) : (
            summaryLine(activity)
          )}
        </span>
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-gray-9 transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {showSteps && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 ml-1.75 border-l pl-3 space-y-1">
              {hiddenCount > 0 && (
                <button
                  type="button"
                  className="text-xs text-gray-11 hover:text-gray-12"
                  onClick={() => setExpanded(true)}
                >
                  {t('{count, plural, =1 {+1 more step} other {+# more steps}}', {
                    count: hiddenCount,
                  })}
                </button>
              )}
              <AnimatePresence initial={false}>
                {shownSteps.map((step) => (
                  <StepLine key={step.id} step={step} />
                ))}
              </AnimatePresence>
              {running && <WorkingLine />}
            </div>
            {expanded && !running && activity.report && (
              <div className="mt-2 ml-4.75 rounded-lg bg-gray-3 px-3 py-2 text-xs text-gray-12">
                <Markdown>{activity.report}</Markdown>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StepLine({ step }: { step: SubagentStep }) {
  const Icon = toolIconUtils.getToolIcon(step.toolName);
  return (
    <motion.div
      className="flex min-w-0 items-baseline gap-2 text-xs"
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15 }}
    >
      <Icon
        className={cn(
          'h-3 w-3 shrink-0 translate-y-px',
          step.status === 'failed' ? 'text-warning-11' : 'text-gray-11',
        )}
      />
      <span className="shrink-0 text-gray-12">
        {chatUtils.labelForToolName(step.toolName, 'done')}
      </span>
      {step.summary && (
        <TextWithTooltip tooltipMessage={step.summary}>
          <p className="min-w-0 truncate font-mono text-xss text-gray-11">
            {step.summary}
          </p>
        </TextWithTooltip>
      )}
    </motion.div>
  );
}

function WorkingLine() {
  const reduceMotion = useReducedMotion();
  return (
    <div className="flex items-center gap-2 text-xs text-gray-11">
      <Loader2
        className={cn('h-3 w-3 shrink-0', !reduceMotion && 'animate-spin')}
      />
      <span>{t('Working…')}</span>
    </div>
  );
}

function StatusDot({ status }: { status: SubagentActivity['status'] }) {
  if (status === 'done') {
    return (
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-success-9">
        <Check className="h-2.5 w-2.5 text-on-success" strokeWidth={3} />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-warning-9">
        <X className="h-2.5 w-2.5 text-on-warning" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-9/40 motion-reduce:animate-none" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-10" />
    </span>
  );
}

function Elapsed({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return <>{formatDuration(now - Date.parse(startedAt))}</>;
}

function summaryLine(activity: SubagentActivity): string {
  const steps = t('{count, plural, =1 {1 step} other {# steps}}', {
    count: activity.steps.length,
  });
  const duration =
    activity.durationMs === undefined
      ? ''
      : ` · ${formatDuration(activity.durationMs)}`;
  const outcome = activity.status === 'failed' ? t('Stopped') : t('Done');
  return `${outcome} · ${steps}${duration}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0
    ? `${seconds}s`
    : `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function resolveActivity({
  live,
  part,
  isStreaming,
}: {
  live: SubagentActivity | undefined;
  part: AnyToolPart;
  isStreaming: boolean;
}): SubagentActivity {
  const saved = activityFromOutput(part);
  if (saved) return saved;
  if (live) return live;
  const input = isObject(part.input) ? part.input : {};
  return {
    flowName:
      typeof input['flowName'] === 'string' ? input['flowName'] : t('Flow'),
    status: isStreaming ? 'running' : 'failed',
    steps: [],
    startedAt: new Date().toISOString(),
  };
}

function activityFromOutput(part: AnyToolPart): SubagentActivity | null {
  if (part.state !== 'output-available') return null;
  const output = parseOutput(part.output);
  if (!isObject(output) || !isObject(output['activity'])) return null;
  const activity = output['activity'];
  return isSubagentActivity(activity) ? activity : null;
}

function isSubagentActivity(value: unknown): value is SubagentActivity {
  return (
    isObject(value) &&
    typeof value['flowName'] === 'string' &&
    typeof value['startedAt'] === 'string' &&
    (value['status'] === 'running' ||
      value['status'] === 'done' ||
      value['status'] === 'failed') &&
    Array.isArray(value['steps'])
  );
}

function parseOutput(output: unknown): unknown {
  if (typeof output !== 'string') return output;
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

const LIVE_STEP_COUNT = 3;
