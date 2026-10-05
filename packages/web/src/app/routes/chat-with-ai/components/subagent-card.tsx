import { isObject } from '@activepieces/core-utils';
import { SubagentActivity, SubagentStep } from '@activepieces/shared';
import { t } from 'i18next';
import { AlertTriangle, Check, Circle, Loader2 } from 'lucide-react';
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
              '{count, plural, =1 {Building your flow} other {Building # flows at once}}',
              { count: builders.length },
            )
          : t(
              '{count, plural, =1 {Your flow is built} other {# flows built}}',
              { count: builders.length },
            )}
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
  const phase = currentPhase(activity.steps);

  return (
    <div className="px-1.5">
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-gray-3"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <StatusMark status={activity.status} />
        <div className="min-w-0 flex-1">
          <TextWithTooltip tooltipMessage={activity.flowName}>
            <p className="truncate text-sm font-medium text-gray-12">
              {activity.flowName}
            </p>
          </TextWithTooltip>
          <LiveLine activity={activity} phase={phase} />
        </div>
        <AppLogos pieces={activity.pieces ?? []} />
        <Duration activity={activity} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden pb-2 pl-11 pr-3"
          >
            <ol>
              {PHASES.map((milestone, index) => (
                <Milestone
                  key={milestone.id}
                  label={t(
                    milestoneState({ activity, phase, index }) === 'done'
                      ? milestone.done
                      : milestone.active,
                  )}
                  state={milestoneState({ activity, phase, index })}
                />
              ))}
            </ol>
            {activity.status === 'failed' && activity.report && (
              <div className="mt-2 rounded-lg bg-warning-3 px-3 py-2 text-xs text-gray-12">
                <Markdown>{activity.report}</Markdown>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LiveLine({
  activity,
  phase,
}: {
  activity: SubagentActivity;
  phase: number;
}) {
  if (activity.status === 'done') {
    return <p className="text-xs leading-4 text-gray-11">{t('Ready')}</p>;
  }
  if (activity.status === 'failed') {
    return (
      <p className="text-xs leading-4 text-warning-11">{t('Needs a look')}</p>
    );
  }
  const label =
    activity.steps.length === 0 ? 'Getting started' : PHASES[phase].active;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={label}
        initial={{ opacity: 0, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -3 }}
        transition={{ duration: 0.18 }}
      >
        <TextShimmer as="p" className="text-xs font-normal leading-4">
          {t(label)}
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

function Milestone({
  label,
  state,
}: {
  label: string;
  state: 'done' | 'active' | 'todo';
}) {
  return (
    <li className="flex items-center gap-2 py-0.5 text-xs">
      {state === 'done' && (
        <Check className="size-3.5 text-success-10" strokeWidth={2.5} />
      )}
      {state === 'active' && (
        <Loader2 className="size-3.5 animate-spin text-accent-10 motion-reduce:animate-none" />
      )}
      {state === 'todo' && <Circle className="size-3.5 text-gray-9" />}
      <span className={cn(state === 'todo' ? 'text-gray-11' : 'text-gray-12')}>
        {label}
      </span>
    </li>
  );
}

function milestoneState({
  activity,
  phase,
  index,
}: {
  activity: SubagentActivity;
  phase: number;
  index: number;
}): 'done' | 'active' | 'todo' {
  if (activity.status !== 'running') {
    return index <= phase || activity.status === 'done' ? 'done' : 'todo';
  }
  if (index < phase) return 'done';
  return index === phase ? 'active' : 'todo';
}

function currentPhase(steps: SubagentStep[]): number {
  const last = steps[steps.length - 1];
  if (!last) return 0;
  const index = PHASES.findIndex((phase) =>
    phase.tools.includes(last.toolName),
  );
  return index === -1 ? 0 : index;
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
      typeof input['flowName'] === 'string' ? input['flowName'] : t('New flow'),
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

const MAX_LOGOS = 3;
const PLUMBING_PIECES = ['@activepieces/piece-subflows'];

const PHASES = [
  {
    id: 'explore',
    active: 'Looking at the apps',
    done: 'Picked the apps',
    tools: [
      'ap_research_pieces',
      'ap_search_actions',
      'ap_search_triggers',
      'ap_get_piece_props',
      'ap_resolve_property_options',
      'ap_resolve_property_chain',
      'ap_list_connections',
      'ap_list_tables',
    ],
  },
  {
    id: 'build',
    active: 'Building the steps',
    done: 'Built the steps',
    tools: [
      'ap_build_flow',
      'ap_add_step',
      'ap_update_step',
      'ap_update_trigger',
      'ap_delete_step',
      'ap_add_branch',
      'ap_update_branch',
      'ap_delete_branch',
    ],
  },
  {
    id: 'check',
    active: 'Checking everything works',
    done: 'Checked everything works',
    tools: [
      'ap_validate_step_config',
      'ap_validate_flow',
      'ap_flow_structure',
      'ap_read_step_settings',
    ],
  },
];
