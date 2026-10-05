import { isObject } from '@activepieces/core-utils';
import { SubagentActivity } from '@activepieces/shared';
import { t } from 'i18next';
import { AlertTriangle, Check, Hand, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';

import { TextWithTooltip } from '@/components/custom/text-with-tooltip';
import { Markdown } from '@/components/prompt-kit/markdown';
import { TextShimmer } from '@/components/ui/text-shimmer';
import { ToolCallMeta } from '@/features/chat/lib/chat-store';
import { AnyToolPart } from '@/features/chat/lib/chat-types';
import { PieceIcon } from '@/features/pieces/components/piece-icon';
import { piecesHooks } from '@/features/pieces/hooks/pieces-hooks';
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
  const working = activities.some(
    ({ activity }) => activity.status === 'running',
  );

  return (
    <motion.div
      className="my-2 overflow-hidden rounded-xl border bg-panel"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="px-4 pt-3 pb-1 text-xs text-gray-11">
        {working
          ? t(
              '{count, plural, =1 {Working on a task} other {Working on # tasks at once}}',
              { count: builders.length },
            )
          : t('{count, plural, =1 {Task finished} other {# tasks finished}}', {
              count: builders.length,
            })}
      </div>
      <div className="pb-1.5">
        {activities.map(({ toolCallId, activity }) => (
          <SubagentRow key={toolCallId} activity={activity} />
        ))}
      </div>
    </motion.div>
  );
}

function SubagentRow({ activity }: { activity: SubagentActivity }) {
  const [open, setOpen] = useState(false);
  const history = activity.statusHistory ?? [];
  const artifacts = activity.artifacts ?? [];
  const note =
    activity.status === 'blocked'
      ? activity.needs
      : activity.status === 'failed'
      ? activity.summary
      : undefined;
  const hasDetails =
    history.length > 0 || artifacts.length > 0 || Boolean(note);

  return (
    <div className="px-1.5">
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-gray-3 disabled:hover:bg-transparent"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        disabled={!hasDetails}
      >
        <StatusMark status={activity.status} />
        <div className="min-w-0 flex-1">
          <TextWithTooltip tooltipMessage={activity.title}>
            <p className="truncate text-sm font-medium text-gray-12">
              {activity.title}
            </p>
          </TextWithTooltip>
          <LiveLine activity={activity} />
        </div>
        <AppLogos pieces={activity.pieces ?? []} />
        <Duration activity={activity} />
      </button>

      <AnimatePresence initial={false}>
        {open && hasDetails && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden pb-2 pl-11 pr-3"
          >
            <ol>
              {history.map((line, index) => (
                <Milestone
                  key={`${index}-${line}`}
                  label={line}
                  active={
                    activity.status === 'running' &&
                    index === history.length - 1
                  }
                />
              ))}
            </ol>
            {artifacts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {artifacts.map((artifact) => (
                  <span
                    key={`${artifact.type}-${artifact.id}`}
                    className="max-w-full truncate rounded-md bg-gray-3 px-2 py-0.5 text-xs text-gray-12"
                  >
                    {artifact.name}
                  </span>
                ))}
              </div>
            )}
            {note && (
              <div
                className={cn(
                  'mt-2 rounded-lg px-3 py-2 text-xs text-gray-12',
                  activity.status === 'blocked'
                    ? 'bg-accent-3'
                    : 'bg-warning-3',
                )}
              >
                <Markdown>{note}</Markdown>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LiveLine({ activity }: { activity: SubagentActivity }) {
  if (activity.status === 'done') {
    return <p className="text-xs leading-4 text-gray-11">{t('Done')}</p>;
  }
  if (activity.status === 'blocked') {
    return (
      <p className="text-xs leading-4 text-accent-11">
        {t('Needs your input')}
      </p>
    );
  }
  if (activity.status === 'failed') {
    return (
      <p className="text-xs leading-4 text-warning-11">{t('Needs a look')}</p>
    );
  }
  const label = activity.statusLine ?? t('Getting started');
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={label}
        initial={{ opacity: 0, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -3 }}
        transition={{ duration: 0.18 }}
      >
        <TextShimmer as="p" className="truncate text-xs font-normal leading-4">
          {label}
        </TextShimmer>
      </motion.div>
    </AnimatePresence>
  );
}

function StatusMark({ status }: { status: SubagentActivity['status'] }) {
  if (status === 'done') {
    return (
      <motion.span
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-success-9"
      >
        <Check className="size-3 text-on-success" strokeWidth={3} />
      </motion.span>
    );
  }
  if (status === 'blocked') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-3">
        <Hand className="size-3 text-accent-11" />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-warning-3">
        <AlertTriangle className="size-3 text-warning-11" />
      </span>
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center">
      <Loader2 className="size-4 animate-spin text-accent-10 motion-reduce:animate-none" />
    </span>
  );
}

function AppLogos({ pieces }: { pieces: string[] }) {
  const apps = pieces.filter(
    (pieceName) => !PLUMBING_PIECES.includes(pieceName),
  );
  if (apps.length === 0) return null;
  const shown = apps.slice(0, MAX_LOGOS);
  const extra = apps.length - shown.length;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {shown.map((pieceName) => (
        <AppLogo key={pieceName} pieceName={pieceName} />
      ))}
      {extra > 0 && (
        <span className="text-xss text-gray-11 tabular-nums">+{extra}</span>
      )}
    </div>
  );
}

function Duration({ activity }: { activity: SubagentActivity }) {
  if (activity.status === 'running') {
    return activity.startedAt.length > 0 ? (
      <Elapsed startedAt={activity.startedAt} />
    ) : null;
  }
  if (activity.durationMs === undefined) return null;
  return (
    <span className="w-12 shrink-0 text-right text-xs text-gray-11 tabular-nums">
      {formatDuration(activity.durationMs)}
    </span>
  );
}

function Elapsed({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="w-12 shrink-0 text-right text-xs text-gray-11 tabular-nums">
      {formatDuration(now - Date.parse(startedAt))}
    </span>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0
    ? `${seconds}s`
    : `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function AppLogo({ pieceName }: { pieceName: string }) {
  const { summary } = piecesHooks.usePieceSummary({ name: pieceName });
  if (!summary?.logoUrl) return null;
  return (
    <PieceIcon
      size="xs"
      border={false}
      displayName={summary.displayName}
      logoUrl={summary.logoUrl}
      showTooltip={true}
    />
  );
}

function Milestone({ label, active }: { label: string; active: boolean }) {
  return (
    <li className="flex items-center gap-2 py-0.5 text-xs">
      {active ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-accent-10 motion-reduce:animate-none" />
      ) : (
        <Check
          className="size-3.5 shrink-0 text-success-10"
          strokeWidth={2.5}
        />
      )}
      <span className="text-gray-12">{label}</span>
    </li>
  );
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
  if (live) {
    const stoppedMidRun = live.status === 'running' && !isStreaming;
    return stoppedMidRun ? { ...live, status: 'failed' } : live;
  }
  const input = isObject(part.input) ? part.input : {};
  return {
    title: typeof input['title'] === 'string' ? input['title'] : t('Task'),
    status: isStreaming ? 'running' : 'failed',
    steps: [],
    startedAt: '',
  };
}

function activityFromOutput(part: AnyToolPart): SubagentActivity | null {
  if (part.state !== 'output-available') return null;
  const output = parseOutput(part.output);
  if (!isObject(output)) return null;
  const activity = output['activity'];
  return isSubagentActivity(activity) ? activity : null;
}

function isSubagentActivity(value: unknown): value is SubagentActivity {
  return (
    isObject(value) &&
    typeof value['title'] === 'string' &&
    typeof value['startedAt'] === 'string' &&
    typeof value['status'] === 'string' &&
    STATUSES.includes(value['status']) &&
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

const MAX_LOGOS = 3;
const PLUMBING_PIECES = ['@activepieces/piece-subflows'];
const STATUSES: string[] = ['running', 'done', 'blocked', 'failed'];
