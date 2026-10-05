import { AIProviderName, isNil, isObject, tryCatch, tryCatchSync } from '@activepieces/core-utils'
import { AgentPhase, agentToolClassification, BeginAgentTaskResponse, chatBilling, FinishAgentTaskRequest, PersistedAgentPart, PersistedAgentPartType, PersistedToolCallStatus, SubagentActivity, SubagentLink, SubagentStep, SubagentTimelineEntry, TASK_COMPLETION_TOOL_NAME } from '@activepieces/shared'
import { hasToolCall, isLoopFinished, LanguageModel, ModelMessage, tool, ToolSet } from 'ai'
import { z } from 'zod'
import { AgentTurnResult, runAgentTurn, RunAgentTurnParams } from '../run-agent-turn'
import { createPhaseTools } from './session-tools'
import { taskContext } from './task-context'
import { AgentEventEmitter } from './tool-primitives'

export function createTaskSubagentTools({ tools, model, provider, tier, modelId, taskPrompt, creditsLeftFor, beginTask, finishTask, eventEmitter, abortSignal, log }: {
    tools: ToolSet
    model: LanguageModel
    provider: AIProviderName
    tier: RunAgentTurnParams['tier']
    modelId: string
    taskPrompt: string | undefined
    creditsLeftFor: (runKey: string) => RunAgentTurnParams['creditsLeft']
    beginTask: (input: { title: string, taskId?: string }) => Promise<BeginAgentTaskResponse>
    finishTask: (input: Omit<FinishAgentTaskRequest, 'platformId' | 'conversationId'>) => Promise<void>
    eventEmitter: AgentEventEmitter
    abortSignal: AbortSignal
    log: RunAgentTurnParams['log']
}): ToolSet {
    if (isNil(taskPrompt)) {
        return {}
    }
    const workerTools = Object.fromEntries(Object.entries(tools).filter(([name]) => !NOT_FOR_TASKS.includes(name)))
    return {
        [TASK_TOOL_NAME]: tool({
            description: 'Hand one self-contained goal to a focused sub-agent with its own fresh context and the same tools you have (read, search, build, update, execute; risky actions still ask the user for approval). Use it when it buys something: goals that can run in parallel (several calls in one step run at once), like the separate flows of a multi-flow solution or deep research on several subjects (one task per competitor, vendor or app, each doing several searches and reading pages, while you compare the briefs and do the final step); or noisy preparation with a short answer (going through many records or runs, investigating a failure). Build a single flow, make small edits and do quick one-search lookups yourself. It cannot ask the user anything: when it needs something only the user can give it finishes as blocked and says what. Pass taskId to continue a task you started earlier in this conversation (after a block, or for a follow-up on what it built).',
            inputSchema: taskInput,
            toModelOutput: ({ output }) => ({ type: 'text', value: modelView(output) }),
            execute: async ({ title, brief, taskId }, { toolCallId }) => {
                const { data: begun, error } = await tryCatch(() => beginTask({ title, ...(isNil(taskId) ? {} : { taskId }) }))
                if (error || isNil(begun)) {
                    return { status: 'failed', summary: `Could not start this task: ${error instanceof Error ? error.message : 'unknown error'}` }
                }
                const startedAt = new Date()
                const report = (activity: SubagentActivity) => eventEmitter.emitSubagentProgress({ toolCallId, data: { ...activity, taskId: begun.taskId } })
                report({ title, status: 'running', steps: [], startedAt: startedAt.toISOString() })
                const finish: { result?: TaskResult } = {}
                const priorMessages = begun.messages.filter(isModelMessage)
                const messages: ModelMessage[] = [...priorMessages, { role: 'user', content: brief }]
                const phaseState: { phase: AgentPhase } = { phase: 'build' }
                const taskTools = {
                    ...workerTools,
                    ...createPhaseTools({ onPhaseChange: (phase) => {
                        phaseState.phase = phase
                    } }),
                    ...finishTool(finish),
                }
                const turnParams: RunAgentTurnParams = {
                    model,
                    provider,
                    systemPrompt: taskPrompt,
                    messages,
                    tools: taskTools,
                    allToolNames: Object.keys(taskTools),
                    tier,
                    modelId,
                    phaseState,
                    abortSignal,
                    log,
                    creditsLeft: creditsLeftFor(toolCallId),
                    stopWhen: [isLoopFinished(), hasToolCall(TASK_COMPLETION_TOOL_NAME)],
                    sinks: {
                        drainStream: async (result) => {
                            await result.consumeStream()
                        },
                        onProgress: ({ uiParts }) => report(runningActivity({ title, uiParts, startedAt })),
                    },
                }
                const workTurn = await workUntilSettled({ title, turnParams, finished: () => !isNil(finish.result) })
                const turn = isNil(finish.result) && endedCleanly({ turn: workTurn, abortSignal })
                    ? await continueTurn({ title, turnParams, previous: workTurn, request: REPORT_REQUEST, overrides: { tools: finishTool(finish), allToolNames: [TASK_COMPLETION_TOOL_NAME], stepCeiling: 1 } })
                    : workTurn
                const result = finish.result ?? fallbackResult(turn)
                const activity = finalActivity({ title, turn, result, startedAt })
                await tryCatch(() => finishTask({
                    taskId: begun.taskId,
                    status: STATUS_BY_RESULT[result.status],
                    messages: [...messages, ...turn.accumulatedResponseMessages],
                    summary: result.summary,
                    artifacts: result.artifacts,
                }))
                report(activity)
                return {
                    taskId: begun.taskId,
                    status: result.status,
                    summary: result.summary,
                    artifacts: result.artifacts,
                    ...(isNil(result.needs) ? {} : { needs: result.needs }),
                    activity,
                    billedToolCalls: billedToolCalls(turn.uiParts),
                }
            },
        }),
    }
}

async function workUntilSettled({ title, turnParams, finished }: {
    title: string
    turnParams: RunAgentTurnParams
    finished: () => boolean
}): Promise<AgentTurnResult> {
    const first = await taskContext.run({ title, fn: () => runAgentTurn(turnParams) })
    return continueAfterInterruptions({ title, turnParams, finished, turn: first, continuationsLeft: MAX_CONTINUATIONS })
}

async function continueAfterInterruptions({ title, turnParams, finished, turn, continuationsLeft }: {
    title: string
    turnParams: RunAgentTurnParams
    finished: () => boolean
    turn: AgentTurnResult
    continuationsLeft: number
}): Promise<AgentTurnResult> {
    const shouldContinue = !finished() && continuationsLeft > 0 && interruptedTransiently({ turn, abortSignal: turnParams.abortSignal })
    if (!shouldContinue) {
        return turn
    }
    const continued = await continueTurn({ title, turnParams, previous: turn, request: CONTINUE_REQUEST, overrides: {} })
    return continueAfterInterruptions({ title, turnParams, finished, turn: continued, continuationsLeft: continuationsLeft - 1 })
}

async function continueTurn({ title, turnParams, previous, request, overrides }: {
    title: string
    turnParams: RunAgentTurnParams
    previous: AgentTurnResult
    request: string
    overrides: Partial<RunAgentTurnParams>
}): Promise<AgentTurnResult> {
    const requestMessage: ModelMessage = { role: 'user', content: request }
    const next = await taskContext.run({
        title,
        fn: () => runAgentTurn({
            ...turnParams,
            ...overrides,
            messages: [...turnParams.messages, ...previous.accumulatedResponseMessages, requestMessage],
        }),
    })
    return {
        ...next,
        uiParts: [...previous.uiParts, ...next.uiParts],
        accumulatedResponseMessages: [...previous.accumulatedResponseMessages, requestMessage, ...next.accumulatedResponseMessages],
    }
}

function interruptedTransiently({ turn, abortSignal }: { turn: AgentTurnResult, abortSignal: AbortSignal }): boolean {
    const outOfBudget = turn.creditsExhausted || turn.budgetExceeded
    return !abortSignal.aborted && !outOfBudget && (turn.streamError !== null || turn.truncatedAfterRetries)
}

function endedCleanly({ turn, abortSignal }: { turn: AgentTurnResult, abortSignal: AbortSignal }): boolean {
    return !abortSignal.aborted && turn.streamError === null && !turn.creditsExhausted && !turn.budgetExceeded
}

function finishTool(finish: { result?: TaskResult }): ToolSet {
    return {
        [TASK_COMPLETION_TOOL_NAME]: tool({
            description: 'Call this exactly once, as your last action, to hand your result back. status: done when the goal is achieved, blocked when only the user can unblock you (say what in needs), failed when you tried and could not. summary: a few plain sentences the main assistant can relay. artifacts: everything you created or changed (flows, tables, records, agents) with ids and names.',
            inputSchema: taskResult,
            execute: async (result) => {
                finish.result = result
                return { content: [{ type: 'text', text: 'Result recorded.' }] }
            },
        }),
    }
}

function fallbackResult(turn: AgentTurnResult): TaskResult {
    const lastMessage = lastText(turn.uiParts)
    return {
        status: 'failed',
        summary: lastMessage.length > 0 ? lastMessage : 'The task stopped without reporting a result. Check its work before relying on it.',
        artifacts: [],
    }
}

function runningActivity({ title, uiParts, startedAt }: { title: string, uiParts: PersistedAgentPart[], startedAt: Date }): SubagentActivity {
    const timeline = timelineFrom(uiParts)
    const statuses = timeline.flatMap((entry) => entry.kind === 'status' ? [entry.text] : [])
    return {
        title,
        status: 'running',
        statusLine: statuses[statuses.length - 1],
        timeline,
        steps: stepsFrom(uiParts),
        pieces: piecesFrom(uiParts),
        startedAt: startedAt.toISOString(),
    }
}

function finalActivity({ title, turn, result, startedAt }: { title: string, turn: AgentTurnResult, result: TaskResult, startedAt: Date }): SubagentActivity {
    const stoppedEarly = turn.streamError !== null || turn.creditsExhausted || turn.budgetExceeded || turn.truncatedAfterRetries
    return {
        ...runningActivity({ title, uiParts: turn.uiParts, startedAt }),
        status: stoppedEarly ? 'failed' : result.status,
        artifacts: result.artifacts,
        summary: result.summary,
        ...(isNil(result.needs) ? {} : { needs: result.needs }),
        durationMs: Date.now() - startedAt.getTime(),
    }
}

function stepsFrom(parts: PersistedAgentPart[]): SubagentStep[] {
    return parts.flatMap((part): SubagentStep[] => part.type === PersistedAgentPartType.TOOL_CALL
        ? [{ id: part.toolCallId, toolName: part.toolName, status: stepFailed(part.status, part.output) ? 'failed' : 'done', summary: firstLine(part.output) }]
        : [])
}

function timelineFrom(parts: PersistedAgentPart[]): SubagentTimelineEntry[] {
    const titles = new Map(parts.flatMap((part) => isSearchCall(part) ? searchResults(part.output) : []).map((link) => [link.url, link.title]))
    return parts.flatMap((part): SubagentTimelineEntry[] => {
        if (part.type === PersistedAgentPartType.THINKING_STATUS) {
            const text = part.text.trim()
            return text.length > 0 ? [{ kind: 'status', text }] : []
        }
        if (part.type !== PersistedAgentPartType.TOOL_CALL || !isObject(part.input)) {
            return []
        }
        const query = part.input['query']
        if (part.toolName === WEB_SEARCH_TOOL && typeof query === 'string') {
            return [{ kind: 'search', query, results: searchResults(part.output) }]
        }
        const url = part.input['url']
        if (PAGE_READ_TOOLS.includes(part.toolName) && typeof url === 'string') {
            const title = titles.get(url)
            return [{ kind: 'read', url, ...(isNil(title) ? {} : { title }) }]
        }
        return []
    })
}

function isSearchCall(part: PersistedAgentPart): boolean {
    return part.type === PersistedAgentPartType.TOOL_CALL && part.toolName === WEB_SEARCH_TOOL
}

function searchResults(output: unknown): SubagentLink[] {
    const parsed = typeof output === 'string' ? parseJson(output) : output
    if (!isObject(parsed) || !Array.isArray(parsed['results'])) {
        return []
    }
    return parsed['results'].flatMap((result): SubagentLink[] => {
        if (!isObject(result) || typeof result['url'] !== 'string' || result['url'].length === 0) {
            return []
        }
        const title = typeof result['title'] === 'string' && result['title'].length > 0 ? result['title'] : undefined
        return [{ url: result['url'], ...(isNil(title) ? {} : { title }) }]
    })
}

function parseJson(text: string): unknown {
    const { data } = tryCatchSync(() => JSON.parse(text))
    return data
}

function modelView(output: unknown): string {
    const forModel = isObject(output) ? Object.fromEntries(Object.entries(output).filter(([key]) => !CARD_ONLY_FIELDS.includes(key))) : output
    return JSON.stringify(forModel)
}

function billedToolCalls(parts: PersistedAgentPart[]): { toolName: string, output: unknown }[] {
    return parts.flatMap((part) => part.type === PersistedAgentPartType.TOOL_CALL && part.status === PersistedToolCallStatus.COMPLETED && chatBilling.isFlatBilledToolCall({ toolName: part.toolName, output: part.output })
        ? [{ toolName: part.toolName, output: billingOutput(part.output) }]
        : [])
}

function billingOutput(output: unknown): Record<string, unknown> {
    return isObject(output) && output['billedAtCost'] === true ? { billedAtCost: true } : {}
}

function stepFailed(status: PersistedToolCallStatus, output: unknown): boolean {
    return status === PersistedToolCallStatus.ERROR || agentToolClassification.hasFailureTextPrefix(outputText(output).trim())
}

function piecesFrom(parts: PersistedAgentPart[]): string[] {
    const names = parts.flatMap((part) => part.type === PersistedAgentPartType.TOOL_CALL ? pieceNamesIn(part.input) : [])
    return [...new Set(names)]
}

function pieceNamesIn(input: unknown): string[] {
    if (!isObject(input)) {
        return []
    }
    const own = typeof input['pieceName'] === 'string' ? [input['pieceName']] : []
    const trigger = pieceNamesIn(input['trigger'])
    const steps = Array.isArray(input['steps']) ? input['steps'].flatMap(pieceNamesIn) : []
    return [...trigger, ...own, ...steps]
}

function firstLine(output: unknown): string {
    const text = outputText(output).trim().split('\n')[0] ?? ''
    return text.length > SUMMARY_MAX_LENGTH ? `${text.slice(0, SUMMARY_MAX_LENGTH)}…` : text
}

function outputText(output: unknown): string {
    if (typeof output === 'string') {
        return output
    }
    if (!isObject(output)) {
        return ''
    }
    const content = output['content']
    if (Array.isArray(content)) {
        return content.map((item) => isObject(item) && typeof item['text'] === 'string' ? item['text'] : '').join(' ')
    }
    return typeof output['text'] === 'string' ? output['text'] : ''
}

function lastText(parts: PersistedAgentPart[]): string {
    const texts = parts.flatMap((part) => part.type === PersistedAgentPartType.TEXT && part.text.trim().length > 0 ? [part.text.trim()] : [])
    return texts[texts.length - 1] ?? ''
}

function isModelMessage(value: unknown): value is ModelMessage {
    return isObject(value) && typeof value['role'] === 'string' && 'content' in value
}

const taskInput = z.object({
    title: z.string().min(1).describe('A short plain name for the task the user will see, e.g. "Build Save order" or "Research Twilio WhatsApp"'),
    brief: z.string().min(1).describe('Everything the sub-agent needs, self-contained: the goal and when it is done, what it owns (and must not change), ids and decisions already made, connections to use. For a resumed task, the new instruction or the user\'s answer.'),
    taskId: z.string().optional().describe('Continue a task from earlier in this conversation instead of starting a new one'),
})

const taskResult = z.object({
    status: z.enum(['done', 'blocked', 'failed']),
    summary: z.string().describe('A few plain sentences: what you did and what the main assistant should tell the user'),
    artifacts: z.array(z.object({ type: z.string(), id: z.string(), name: z.string() })).describe('Everything you created or changed'),
    needs: z.string().optional().describe('When blocked: exactly what you need from the user'),
})

const STATUS_BY_RESULT: Record<TaskResult['status'], FinishAgentTaskRequest['status']> = {
    done: 'DONE',
    blocked: 'BLOCKED',
    failed: 'FAILED',
}

const TASK_TOOL_NAME = 'ap_run_task'
const REPORT_REQUEST = `You stopped without reporting. Call ${TASK_COMPLETION_TOOL_NAME} now with your result.`
const CONTINUE_REQUEST = 'You were cut off. Continue from where you stopped.'
const MAX_CONTINUATIONS = 2
const WEB_SEARCH_TOOL = 'ap_web_search'
const PAGE_READ_TOOLS = ['ap_fetch_url', 'ap_scrape_url']
const CARD_ONLY_FIELDS = ['activity', 'billedToolCalls']
const SUMMARY_MAX_LENGTH = 120

const NOT_FOR_TASKS = [
    TASK_TOOL_NAME,
    'ap_show_questions',
    'ap_show_quick_replies',
    'ap_show_connection_picker',
    'ap_show_connection_required',
    'ap_show_project_picker',
    'ap_show_mcp_reconnect',
    'ap_show_showcase',
    'ap_set_build_plan',
    'ap_select_project',
    'ap_deselect_project',
    'ap_remember',
    'ap_generate_image',
    'ap_test_flow',
    'ap_test_step',
    'ap_lock_and_publish',
    'ap_change_flow_status',
]

type TaskResult = z.infer<typeof taskResult>
